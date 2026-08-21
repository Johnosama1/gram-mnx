import { json, getSetting, setSetting } from '@/lib/admin.server';
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

export type GiftWinner = {
  id: number;
  name: string | null;
  /** Entrant's chances at draw time — more chances meant proportionally higher odds. */
  chances: number | null;
};

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
  /** How many winners to draw once the contest settles. Defaults to 1. */
  winnerCount: number;
  /**
   * Winners drawn once the deadline passes — weighted by each entrant's
   * chances (see drawWeightedWinners). Set once by settleExpiredGifts and
   * never redrawn afterwards. Empty until settled.
   */
  winners: GiftWinner[];
  settledAt: string | null;
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
  /** Ads watched in the last 24h, and the daily cap. */
  adsToday: number;
  adsDailyLimit: number;
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
        // Back-compat: contests created before multi-winner support stored a
        // single winnerId/winnerName/winnerChances instead of a winners array.
        const winners: GiftWinner[] = Array.isArray(item.winners)
          ? (item.winners as unknown[])
              .map((w) => {
                const rec = w as Record<string, unknown>;
                const wid = Number(rec.id ?? 0);
                if (wid <= 0) return null;
                return {
                  id: wid,
                  name: rec.name ? String(rec.name).slice(0, 120) : null,
                  chances: rec.chances != null && Number(rec.chances) > 0 ? Number(rec.chances) : null,
                };
              })
              .filter((w): w is GiftWinner => w !== null)
          : item.winnerId != null && Number(item.winnerId) > 0
            ? [
                {
                  id: Number(item.winnerId),
                  name: item.winnerName ? String(item.winnerName).slice(0, 120) : null,
                  chances:
                    item.winnerChances != null && Number(item.winnerChances) > 0
                      ? Number(item.winnerChances)
                      : null,
                },
              ]
            : [];
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
          winnerCount: Math.max(1, Number(item.winnerCount ?? 1) || 1),
          winners,
          settledAt: item.settledAt ? String(item.settledAt).slice(0, 40) : null,
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
  const mine = new Map<number, { chances: number; invited: number; adsWatched: number; adsToday: number }>();
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
    const [adsWatched, adsToday] = hasAdsGift
      ? await Promise.all([getGiftAdsWatched(telegramId), getGiftAdsToday(telegramId)])
      : [0, 0];

    for (const gift of gifts) {
      const gid = gift.id;
      const joinedThis = rows.some((r) => r.gift_id === gid && Number(r.telegram_id) === telegramId);
      if (!joinedThis) continue;
      if (gift.entryMode === 'ads') {
        mine.set(gid, {
          chances: 1 + Math.floor(adsWatched / GIFT_AD_CHANCE_STEP),
          invited: 0,
          adsWatched,
          adsToday,
        });
      } else {
        const invited = rows.filter((r) => r.gift_id === gid && Number(r.referred_by) === telegramId).length;
        mine.set(gid, { chances: invited + 1, invited, adsWatched: 0, adsToday: 0 });
      }
    }
  }
  return { counts, mine };
}

/** Every entrant's chances for one contest — same weighting rules as loadEntryStats, but for all participants, not just one caller. Used only to draw a weighted winner. */
async function computeAllChances(db: any, gift: GiftItem): Promise<Map<number, number>> {
  const { data } = await db
    .from('gm_gift_entries')
    .select('telegram_id,referred_by')
    .eq('gift_id', gift.id);
  const rows = (data ?? []) as { telegram_id: number; referred_by: number | null }[];
  const chances = new Map<number, number>();

  if (gift.entryMode === 'ads') {
    await Promise.all(
      rows.map(async (r) => {
        const tid = Number(r.telegram_id);
        const watched = await getGiftAdsWatched(tid, db);
        chances.set(tid, 1 + Math.floor(watched / GIFT_AD_CHANCE_STEP));
      }),
    );
  } else {
    for (const r of rows) {
      const tid = Number(r.telegram_id);
      if (chances.has(tid)) continue;
      const invited = rows.filter((x) => Number(x.referred_by) === tid).length;
      chances.set(tid, invited + 1);
    }
  }
  return chances;
}

/**
 * Picks up to `count` unique telegram ids, weighted by chances — more
 * chances = proportionally higher odds. Each pick removes that entrant from
 * the pool before the next draw, so nobody wins twice in the same contest.
 */
function drawWeightedWinners(chances: Map<number, number>, count: number): number[] {
  const pool = new Map(chances);
  const winners: number[] = [];
  for (let i = 0; i < count; i++) {
    const entries = [...pool.entries()].filter(([, w]) => w > 0);
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    if (total <= 0) break;
    let r = Math.random() * total;
    let picked = entries[entries.length - 1][0];
    for (const [tid, w] of entries) {
      r -= w;
      if (r <= 0) {
        picked = tid;
        break;
      }
    }
    winners.push(picked);
    pool.delete(picked);
  }
  return winners;
}

/** Draws and persists the winners for one expired, not-yet-settled contest. */
async function settleOneGift(db: any, gift: GiftItem): Promise<GiftItem> {
  const chances = await computeAllChances(db, gift);
  const winnerIds = drawWeightedWinners(chances, Math.max(1, gift.winnerCount || 1));

  // Batch the winner profile lookup into one query instead of one per winner.
  const { data: winnerRows } = winnerIds.length
    ? await db.from('gm_users').select('telegram_id,username,first_name').in('telegram_id', winnerIds)
    : { data: [] };
  const byId = new Map<number, { username?: string | null; first_name?: string | null }>(
    ((winnerRows ?? []) as Array<{ telegram_id: number; username?: string | null; first_name?: string | null }>).map(
      (u) => [Number(u.telegram_id), u],
    ),
  );
  const winners: GiftWinner[] = winnerIds.map((winnerId) => {
    const u = byId.get(winnerId);
    return {
      id: winnerId,
      name: u?.username ? `@${u.username}` : (u?.first_name ?? `مستخدم #${winnerId}`),
      chances: chances.get(winnerId) ?? null,
    };
  });

  // Re-read the freshest stored list right before writing so two requests
  // landing at almost the same moment right after expiry can't both draw.
  const all = parseGifts(await getSetting('gifts'));
  const idx = all.findIndex((g) => g.id === gift.id);
  if (idx === -1) return gift; // deleted meanwhile
  if (all[idx].winners.length > 0 || all[idx].settledAt) return all[idx]; // already settled

  const settled: GiftItem = {
    ...all[idx],
    winners,
    settledAt: new Date().toISOString(),
  };
  all[idx] = settled;
  await setSetting('gifts', JSON.stringify(all));

  if (winners.length > 0) {
    try {
      const { notifyUser } = await import('@/lib/admin.server');
      const text =
        winners.length > 1
          ? `🎉 مبروك! أنت من الفائزين في مسابقة "${gift.title}" 🎁`
          : `🎉 مبروك! أنت الفائز في مسابقة "${gift.title}" 🎁`;
      await Promise.all(winners.map((w) => notifyUser(w.id, text).catch(() => undefined)));
    } catch {
      /* best-effort */
    }
  }
  return settled;
}

/**
 * Runs the weighted draw for any contest whose deadline has passed and
 * hasn't been settled yet. There is no background cron in this
 * environment, so this runs lazily on every read (both the public Gifts
 * screen and the admin panel poll this) — the first read after expiry is
 * what settles it, which for an actively-used contest is within seconds.
 */
export async function settleExpiredGifts(gifts: GiftItem[]): Promise<GiftItem[]> {
  const pending = gifts.filter(
    (g) => g.endsAt && Date.parse(g.endsAt) < Date.now() && g.winners.length === 0 && !g.settledAt,
  );
  if (pending.length === 0) return gifts;

  const db = (await getDb()) as any;
  const settled = new Map<number, GiftItem>();
  for (const gift of pending) {
    settled.set(gift.id, await settleOneGift(db, gift));
  }
  return gifts.map((g) => settled.get(g.id) ?? g);
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

/** Max ads a user may watch per rolling 24 hours (per user, all contests). */
const GIFT_AD_DAILY_LIMIT = 10;

/** Ads watched by the user during the last 24 hours. */
async function getGiftAdsToday(telegramId: number, db?: any): Promise<number> {
  const client = db ?? ((await getDb()) as any);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await client
    .from('gm_gift_ad_views')
    .select('id', { count: 'exact', head: true })
    .eq('telegram_id', telegramId)
    .gte('created_at', since);
  return Number(count ?? 0);
}

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
  const today = await getGiftAdsToday(telegramId, db);
  if (today >= GIFT_AD_DAILY_LIMIT) {
    return {
      ok: false as const,
      error: `وصلت للحد اليومي (${GIFT_AD_DAILY_LIMIT} إعلانات كل 24 ساعة) — تعالى بكرة`,
      limitReached: true as const,
    };
  }
  const { error } = await db.from('gm_gift_ad_views').insert({ telegram_id: telegramId });
  if (error) {
    console.error('[gift] failed to record ad view', error);
    // Surface the raw DB error to admins over Telegram too — Worker logs
    // aren't reachable from the admin panel, and this is the fastest way
    // to see *why* (e.g. "relation does not exist" = migration not applied).
    try {
      const { notifyUser, getAllAdminIds } = await import('@/lib/admin.server');
      const admins = await getAllAdminIds();
      const text = `⚠️ فشل تسجيل مشاهدة إعلان (gift ads)\n${error.message ?? String(error)}`;
      await Promise.all(admins.map((id) => notifyUser(id, text)));
    } catch {
      /* best-effort */
    }
    return { ok: false as const, error: 'تعذر تسجيل المشاهدة، حاول مرة أخرى' };
  }
  const watched = await getGiftAdsWatched(telegramId, db);
  const adsToday = await getGiftAdsToday(telegramId, db);
  return {
    ok: true as const,
    watched,
    adsToday,
    adsDailyLimit: GIFT_AD_DAILY_LIMIT,
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

  const { isGiftAdEnabled } = await import('@/lib/adsgram.server');
  if (!(await isGiftAdEnabled())) return json({ error: 'gift_ads_disabled' }, 403);

  const { rateLimit } = await import('@/lib/rate-limit.server');
  if (!(await rateLimit(`giftads:${auth.id}`, 20, 60)))
    return json({ error: 'حاول مرة أخرى بعد قليل' }, 429);
  // A real ad takes several seconds to play, so two genuine views can never
  // land inside the same short window — this is what actually stops a
  // double-tap or a resent request from recording (and rewarding) twice for
  // the one ad the user watched, on top of the client's own disabled-button
  // guard while a request is in flight.
  if (!(await rateLimit(`giftads-once:${auth.id}`, 1, 8)))
    return json({ error: 'تم تسجيل هذه المشاهدة بالفعل' }, 409);

  const result = await recordGiftAdView(auth.id);
  return json(result, result.ok ? 200 : (result as any).limitReached ? 429 : 500);
}


export async function getGiftState(initData: string | null) {
  const auth = resolveTelegramUser(initData);
  const { getAdsGramBlockId, isGiftAdEnabled } = await import('@/lib/adsgram.server');
  const [cfg, isAdmin, blockId, adEnabled] = await Promise.all([
    getGiftConfig(),
    isAdminUser(auth?.id ?? null),
    getAdsGramBlockId(),
    isGiftAdEnabled(),
  ]);
  // A locked section stays locked for everyone except admins (preview mode).
  if (!cfg.enabled && !isAdmin) {
    return {
      enabled: false,
      message: cfg.message,
      gifts: [] as GiftPublicItem[],
      adminPreview: false,
      blockId,
      adEnabled,
    };
  }

  const settledGiftList = await settleExpiredGifts(cfg.gifts);
  const { counts, mine } = await loadEntryStats(settledGiftList, auth?.id ?? null);

  const gifts: GiftPublicItem[] = settledGiftList.map((g) => {
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
      adsToday: my?.adsToday ?? 0,
      adsDailyLimit: GIFT_AD_DAILY_LIMIT,
      expired: Boolean(g.endsAt && Date.parse(g.endsAt) < Date.now()),
    };
  });

  return {
    enabled: true,
    message: cfg.message,
    gifts,
    telegramId: auth?.id ?? null,
    adminPreview: !cfg.enabled && isAdmin,
    blockId,
    adEnabled,
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
