import { json, getSetting } from '@/lib/admin.server';
import { getDb, resolveTelegramUser, upsertUser } from '@/lib/telegram-user.server';

/**
 * What a participant must do before they can join, and how their chances
 * grow after that:
 * - 'referral': no extra requirement to join. Chances grow by inviting
 *   friends who also join this contest (invite link shown after joining).
 * - 'tasks': must have completed at least one task or played the daily
 *   combo to join. Chances grow the same way as 'referral' (via referrals).
 * - 'ads': joining is just as open as 'referral' — there is no invite link
 *   for this mode though; instead, the joined-contest page has its own
 *   "watch ad" button and every GIFT_AD_CHANCE_STEP ads watched (all-time)
 *   is +1 chance.
 */
export type GiftEntryMode = 'referral' | 'tasks' | 'ads';

export type GiftItem = {
  id: number;
  title: string;
  description: string;
  reward: number;
  link: string | null;
  /** Image / animation of the prize. Supports .json (Lottie) as well as png/jpg/webp. */
  imageUrl: string | null;
  /** 0 = unlimited participants (progress bar hidden on the client). */
  capacity: number;
  /** ISO date-time when the contest ends. null = no deadline. */
  endsAt: string | null;
  entryMode: GiftEntryMode;
};

export type GiftConfig = {
  enabled: boolean;
  message: string;
  gifts: GiftItem[];
};

export type GiftPublicItem = GiftItem & {
  participants: number;
  full: boolean;
  joined: boolean;
  chances: number;
  invitedCount: number;
  /** Total ads watched (all-time) toward this contest's chances — 'ads' mode only. */
  adsWatched: number;
  expired: boolean;
};

const DEFAULT_MESSAGE = 'قريباً — الهدايا لسه مش متاحة';

export function normalizeEntryMode(v: unknown): GiftEntryMode {
  return v === 'tasks' || v === 'ads' ? v : 'referral';
}

export function parseGifts(raw: string | null): GiftItem[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list
      .map((g) => {
        const item = g as Record<string, unknown>;
        return {
          id: Number(item.id ?? 0),
          title: String(item.title ?? '').slice(0, 120),
          description: String(item.description ?? '').slice(0, 500),
          reward: Number(item.reward ?? 0) || 0,
          link: item.link ? String(item.link).slice(0, 300) : null,
          imageUrl: item.imageUrl ? String(item.imageUrl).slice(0, 500) : null,
          capacity: Math.max(0, Number(item.capacity ?? 0) || 0),
          endsAt: item.endsAt ? String(item.endsAt).slice(0, 40) : null,
          entryMode: normalizeEntryMode(item.entryMode),
        };
      })
      .filter((g) => g.id > 0 && g.title);
  } catch {
    return [];
  }
}

export async function getGiftConfig(): Promise<GiftConfig> {
  const [enabled, message, gifts] = await Promise.all([
    getSetting('gift_enabled'),
    getSetting('gift_message'),
    getSetting('gifts'),
  ]);
  return {
    enabled: enabled === 'true',
    message: message ?? DEFAULT_MESSAGE,
    gifts: parseGifts(gifts),
  };
}

/** Reads an inviter telegram id out of a Mini App / bot start param. */
export function parseGiftRef(param: string | null | undefined): number | null {
  const s = (param ?? '').trim();
  if (!s) return null;
  const short = /^g_?(\d+)$/.exec(s);
  const legacy = /^gift_(\d+)_(\d+)$/.exec(s);
  const id = short ? Number(short[1]) : legacy ? Number(legacy[2]) : 0;
  return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * Records that `inviteeId` arrived through `referrerId`'s gift link and
 * pings the referrer. This is a global, one-time-per-invitee ledger used
 * only for the notification — it is NOT the source of a contest's chances
 * (see loadEntryStats below): whether an invite actually counts toward a
 * referrer's chances depends on the invitee joining that specific contest,
 * which is what previously made "my referrals aren't counting" possible —
 * someone could open the app via the link without ever joining, get
 * recorded here, but never show up as an entrant in any contest.
 */
export async function recordGiftInvite(
  inviteeId: number,
  referrerId: number | null,
  inviteeName?: string | null,
): Promise<boolean> {
  if (!referrerId || !inviteeId || referrerId === inviteeId) return false;
  const db = (await getDb()) as any;
  const { data: exists } = await db
    .from('gm_gift_invites')
    .select('invitee_id')
    .eq('invitee_id', inviteeId)
    .maybeSingle();
  if (exists) return false;

  const { error } = await db
    .from('gm_gift_invites')
    .insert({ invitee_id: inviteeId, referrer_id: referrerId });
  if (error) return false;

  try {
    const { notifyUser } = await import('@/lib/admin.server');
    await notifyUser(
      referrerId,
      `🎉 ${inviteeName || 'صديق'} فتح التطبيق عن طريق رابطك!\n\nلازم يشترك فعليًا في المسابقة عشان فرصتك تزيد.`,
    );
  } catch {
    /* notification is best-effort */
  }
  return true;
}

/**
 * participants + the caller's chances per contest, computed live and only
 * from actual entrants (gm_gift_entries) — never from the global invite
 * ledger. How a joined contest's chances grow depends on its entry mode:
 * - 'referral'/'tasks': a referral only ever counts once the referred person
 *   has themselves joined that same contest (which, for 'tasks' contests,
 *   already proves they met the entry requirement too).
 * - 'ads': there is no referral link for this mode at all — chances instead
 *   grow with how many ads the user has watched via the Gifts ads button
 *   (see getGiftAdsWatched), GIFT_AD_CHANCE_STEP ads = +1 chance.
 */
async function loadEntryStats(gifts: GiftItem[], telegramId: number | null) {
  const giftIds = gifts.map((g) => g.id);
  const counts = new Map<number, number>();
  const mine = new Map<number, { chances: number; invited: number; adsWatched: number }>();
  if (giftIds.length === 0) return { counts, mine };

  const db = (await getDb()) as any;
  const { data } = await db
    .from('gm_gift_entries')
    .select('gift_id,telegram_id,referred_by')
    .in('gift_id', giftIds);
  const rows = (data ?? []) as { gift_id: number; telegram_id: number; referred_by: number | null }[];

  for (const row of rows) {
    const gid = Number(row.gift_id);
    counts.set(gid, (counts.get(gid) ?? 0) + 1);
  }

  if (telegramId) {
    const hasAdsGift = gifts.some((g) => g.entryMode === 'ads');
    const adsWatched = hasAdsGift ? await getGiftAdsWatched(telegramId) : 0;

    for (const gift of gifts) {
      const gid = gift.id;
      const joinedThis = rows.some((r) => r.gift_id === gid && Number(r.telegram_id) === telegramId);
      if (!joinedThis) continue;
      if (gift.entryMode === 'ads') {
        mine.set(gid, {
          chances: 1 + Math.floor(adsWatched / GIFT_AD_CHANCE_STEP),
          invited: 0,
          adsWatched,
        });
      } else {
        const invited = rows.filter((r) => r.gift_id === gid && Number(r.referred_by) === telegramId).length;
        mine.set(gid, { chances: invited + 1, invited, adsWatched: 0 });
      }
    }
  }
  return { counts, mine };
}

/**
 * Whether `telegramId` currently satisfies a contest's entry requirement.
 * 'ads' contests have no join-time gate — anyone can join immediately, same
 * as 'referral'; watching ads is purely how they grow their chances after
 * joining (see loadEntryStats).
 */
async function meetsEntryRequirement(
  db: any,
  telegramId: number,
  mode: GiftEntryMode,
): Promise<boolean> {
  if (mode === 'tasks') {
    const [{ count: taskCount }, { count: comboCount }] = await Promise.all([
      db.from('gm_task_completions').select('id', { count: 'exact', head: true }).eq('telegram_id', telegramId),
      db.from('gm_combo_attempts').select('id', { count: 'exact', head: true }).eq('telegram_id', telegramId),
    ]);
    return (taskCount ?? 0) > 0 || (comboCount ?? 0) > 0;
  }
  return true;
}

const ENTRY_REQUIREMENT_MESSAGE: Record<GiftEntryMode, string> = {
  referral: '',
  tasks: 'لازم تكمل مهمة واحدة على الأقل أو تلعب الكومبو اليومي قبل الاشتراك في المسابقة دي',
  ads: '',
};

async function isAdminUser(telegramId: number | null): Promise<boolean> {
  if (!telegramId) return false;
  const { getAllAdminIds } = await import('@/lib/admin.server');
  return (await getAllAdminIds()).includes(telegramId);
}

/**
 * "Ads" entry mode — the alternative to a referral link for a contest: watch
 * ads (via the Gifts screen's own button, tracked in gm_gift_ad_views — a
 * table dedicated to this feature, never the Tasks screen's gm_ad_views) to
 * unlock joining, then keep watching to earn more chances — every
 * GIFT_AD_CHANCE_STEP ads watched (all-time) is +1 chance, computed live by
 * loadEntryStats. No invite link is ever involved for this mode.
 */
const GIFT_AD_CHANCE_STEP = 10;

/** Total ads the user has watched via the Gifts ads button (all-time). */
async function getGiftAdsWatched(telegramId: number, db?: any): Promise<number> {
  const client = db ?? ((await getDb()) as any);
  const { count } = await client
    .from('gm_gift_ad_views')
    .select('id', { count: 'exact', head: true })
    .eq('telegram_id', telegramId);
  return Number(count ?? 0);
}

/** Records one completed ad view. */
async function recordGiftAdView(telegramId: number) {
  const db = (await getDb()) as any;
  await db.from('gm_gift_ad_views').insert({ telegram_id: telegramId });
  const watched = await getGiftAdsWatched(telegramId, db);
  return {
    ok: true as const,
    watched,
    chanceStep: GIFT_AD_CHANCE_STEP,
    justUnlockedChance: watched > 0 && watched % GIFT_AD_CHANCE_STEP === 0,
  };
}

/** POST → records one ad view (only call after the ad actually finished playing). */
export async function handleGiftAdsWatch(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as Record<string, any>;
  const initData =
    request.headers.get('x-init-data') ??
    (typeof body.initData === 'string' ? body.initData : null);
  const auth = resolveTelegramUser(initData);
  if (!auth) return json({ error: 'Unauthorized' }, 401);
  await upsertUser(auth);

  const { rateLimit } = await import('@/lib/rate-limit.server');
  if (!(await rateLimit(`giftads:${auth.id}`, 20, 60)))
    return json({ error: 'حاول مرة أخرى بعد قليل' }, 429);

  return json(await recordGiftAdView(auth.id));
}


export async function getGiftState(initData: string | null) {
  const cfg = await getGiftConfig();
  const auth = resolveTelegramUser(initData);
  const isAdmin = await isAdminUser(auth?.id ?? null);
  // A locked section stays locked for everyone except admins (preview mode).
  if (!cfg.enabled && !isAdmin) {
    return { enabled: false, message: cfg.message, gifts: [] as GiftPublicItem[], adminPreview: false };
  }

  const { counts, mine } = await loadEntryStats(cfg.gifts, auth?.id ?? null);

  const gifts: GiftPublicItem[] = cfg.gifts.map((g) => {
    const participants = counts.get(g.id) ?? 0;
    const my = mine.get(g.id);
    return {
      ...g,
      participants,
      full: g.capacity > 0 && participants >= g.capacity,
      joined: Boolean(my),
      chances: my?.chances ?? 0,
      invitedCount: my?.invited ?? 0,
      adsWatched: my?.adsWatched ?? 0,
      expired: Boolean(g.endsAt && Date.parse(g.endsAt) < Date.now()),
    };
  });

  return {
    enabled: true,
    message: cfg.message,
    gifts,
    telegramId: auth?.id ?? null,
    adminPreview: !cfg.enabled && isAdmin,
  };
}

/** Public gift status endpoint: GET/POST → { enabled, message, gifts } */
export async function handleGiftApi(request: Request): Promise<Response> {
  const body =
    request.method === 'GET'
      ? {}
      : ((await request.json().catch(() => ({}))) as Record<string, any>);
  const initData =
    request.headers.get('x-init-data') ??
    (typeof body.initData === 'string' ? body.initData : null);
  return json(await getGiftState(initData));
}

/**
 * Joins a contest. `ref` is the telegram id of the inviter taken from the
 * Mini App start param — this entry is what gives the inviter +1 chance
 * (computed live by loadEntryStats, not stored here). Blocked up front if
 * the contest requires tasks/combo and the joiner hasn't done that yet
 * ('ads' contests have no join-time gate — see meetsEntryRequirement).
 */
export async function handleGiftJoin(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as Record<string, any>;
  const initData =
    request.headers.get('x-init-data') ??
    (typeof body.initData === 'string' ? body.initData : null);
  const auth = resolveTelegramUser(initData);
  if (!auth) return json({ error: 'Unauthorized' }, 401);
  await upsertUser(auth);

  const { rateLimit } = await import('@/lib/rate-limit.server');
  if (!(await rateLimit(`giftjoin:${auth.id}`, 20, 60)))
    return json({ error: 'حاول مرة أخرى بعد قليل' }, 429);

  const giftId = Number(body.giftId ?? 0);
  const cfg = await getGiftConfig();
  if (!cfg.enabled && !(await isAdminUser(auth.id)))
    return json({ error: 'المسابقات غير متاحة حالياً' }, 403);
  const gift = cfg.gifts.find((g) => g.id === giftId);
  if (!gift) return json({ error: 'المسابقة غير موجودة' }, 404);
  if (gift.endsAt && Date.parse(gift.endsAt) < Date.now())
    return json({ error: 'انتهى وقت المسابقة' }, 409);

  const db = (await getDb()) as any;
  const existing = await db
    .from('gm_gift_entries')
    .select('id')
    .eq('gift_id', giftId)
    .eq('telegram_id', auth.id)
    .maybeSingle();

  if (!existing.data) {
    if (gift.capacity > 0) {
      const { count } = await db
        .from('gm_gift_entries')
        .select('id', { count: 'exact', head: true })
        .eq('gift_id', giftId);
      if ((count ?? 0) >= gift.capacity) return json({ error: 'اكتمل العدد' }, 409);
    }

    if (!(await meetsEntryRequirement(db, auth.id, gift.entryMode))) {
      return json({ error: ENTRY_REQUIREMENT_MESSAGE[gift.entryMode] }, 403);
    }

    // The inviter may arrive from the client or straight from the Mini App start param.
    const startParam = initData ? new URLSearchParams(initData).get('start_param') : null;
    const referrer =
      parseGiftRef(typeof body.ref === 'number' || typeof body.ref === 'string' ? `g_${body.ref}` : null) ??
      parseGiftRef(startParam);

    // Late-binding safety net: if the login step missed the link, record it now.
    if (referrer && referrer !== auth.id) {
      await recordGiftInvite(
        auth.id,
        referrer,
        auth.username ? `@${auth.username}` : (auth.first_name ?? null),
      );
    }

    const { error } = await db.from('gm_gift_entries').insert({
      gift_id: giftId,
      telegram_id: auth.id,
      referred_by: referrer && referrer !== auth.id ? referrer : null,
    });
    if (error && !String(error.message).includes('duplicate'))
      return json({ error: error.message }, 500);
  }

  return json(await getGiftState(initData));
}


/** Serves an uploaded gift media file (private bucket) through our own origin. */
export async function handleGiftMedia(name: string): Promise<Response> {
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const { data, error } = await supabaseAdmin.storage.from('gift-media').download(name);
  if (error || !data) return new Response('Not found', { status: 404 });
  const type = name.toLowerCase().endsWith('.json')
    ? 'application/json'
    : name.toLowerCase().endsWith('.png')
      ? 'image/png'
      : name.toLowerCase().endsWith('.webp')
        ? 'image/webp'
        : name.toLowerCase().endsWith('.gif')
          ? 'image/gif'
          : 'image/jpeg';
  return new Response(await data.arrayBuffer(), {
    headers: { 'content-type': type, 'cache-control': 'public, max-age=31536000, immutable' },
  });
}
