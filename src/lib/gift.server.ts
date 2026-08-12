import { json, getSetting } from '@/lib/admin.server';
import { getDb, resolveTelegramUser, upsertUser } from '@/lib/telegram-user.server';

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
  expired: boolean;
};

const DEFAULT_MESSAGE = 'قريباً — الهدايا لسه مش متاحة';

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

/** How many people joined through this user's gift link (server truth). */
export async function countGiftInvites(db: any, telegramId: number): Promise<number> {
  const { count } = await db
    .from('gm_gift_invites')
    .select('invitee_id', { count: 'exact', head: true })
    .eq('referrer_id', telegramId);
  return count ?? 0;
}

/** Keeps every entry of a user in sync with their real invite count. */
async function syncChances(db: any, telegramId: number, invites: number) {
  await db
    .from('gm_gift_entries')
    .update({ chances: invites + 1, invited_count: invites })
    .eq('telegram_id', telegramId);
}

/**
 * Records that `inviteeId` arrived through `referrerId`'s gift link.
 * Counted once per invitee, at login time — not only when they join a contest.
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

  const invites = await countGiftInvites(db, referrerId);
  await syncChances(db, referrerId, invites);

  try {
    const { notifyUser } = await import('@/lib/admin.server');
    await notifyUser(
      referrerId,
      `🎉 تم دعوة شخص جديد للمسابقة!\n\n👤 ${inviteeName || 'صديق'} دخل عن طريق رابطك\n👥 عدد إحالاتك: ${invites}\n🎟 فرصك في الفوز الآن: ×${invites + 1}`,
    );
  } catch {
    /* notification is best-effort */
  }
  return true;
}

/** participants per contest, computed server-side (never trusted from the client). */
async function loadEntryStats(giftIds: number[], telegramId: number | null) {
  const counts = new Map<number, number>();
  const mine = new Map<number, { chances: number; invited: number }>();
  if (giftIds.length === 0) return { counts, mine };

  const db = (await getDb()) as any;
  const { data } = await db
    .from('gm_gift_entries')
    .select('gift_id,telegram_id,chances,invited_count')
    .in('gift_id', giftIds);

  const invites = telegramId ? await countGiftInvites(db, telegramId) : 0;

  for (const row of (data ?? []) as any[]) {
    const gid = Number(row.gift_id);
    counts.set(gid, (counts.get(gid) ?? 0) + 1);
    if (telegramId && Number(row.telegram_id) === telegramId) {
      mine.set(gid, { chances: invites + 1, invited: invites });
    }
  }
  return { counts, mine };
}

async function isAdminUser(telegramId: number | null): Promise<boolean> {
  if (!telegramId) return false;
  const { getAllAdminIds } = await import('@/lib/admin.server');
  return (await getAllAdminIds()).includes(telegramId);
}


export async function getGiftState(initData: string | null) {
  const cfg = await getGiftConfig();
  const auth = resolveTelegramUser(initData);
  const isAdmin = await isAdminUser(auth?.id ?? null);
  // A locked section stays locked for everyone except admins (preview mode).
  if (!cfg.enabled && !isAdmin) {
    return { enabled: false, message: cfg.message, gifts: [] as GiftPublicItem[], adminPreview: false };
  }

  const ids = cfg.gifts.map((g) => g.id);
  const { counts, mine } = await loadEntryStats(ids, auth?.id ?? null);

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
 * Mini App start param — the inviter gets +1 chance, credited server-side.
 */
export async function handleGiftJoin(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as Record<string, any>;
  const initData =
    request.headers.get('x-init-data') ??
    (typeof body.initData === 'string' ? body.initData : null);
  const auth = resolveTelegramUser(initData);
  if (!auth) return json({ error: 'Unauthorized' }, 401);
  await upsertUser(auth);

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

    const myInvites = await countGiftInvites(db, auth.id);
    const { error } = await db.from('gm_gift_entries').insert({
      gift_id: giftId,
      telegram_id: auth.id,
      chances: myInvites + 1,
      invited_count: myInvites,
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
