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

  for (const row of (data ?? []) as any[]) {
    const gid = Number(row.gift_id);
    counts.set(gid, (counts.get(gid) ?? 0) + 1);
    if (telegramId && Number(row.telegram_id) === telegramId) {
      mine.set(gid, {
        chances: Number(row.chances ?? 1),
        invited: Number(row.invited_count ?? 0),
      });
    }
  }
  return { counts, mine };
}

export async function getGiftState(initData: string | null) {
  const cfg = await getGiftConfig();
  const auth = resolveTelegramUser(initData);
  if (!cfg.enabled) {
    return { enabled: false, message: cfg.message, gifts: [] as GiftPublicItem[] };
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
    };
  });

  return { enabled: true, message: cfg.message, gifts, telegramId: auth?.id ?? null };
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
  if (!cfg.enabled) return json({ error: 'المسابقات غير متاحة حالياً' }, 403);
  const gift = cfg.gifts.find((g) => g.id === giftId);
  if (!gift) return json({ error: 'المسابقة غير موجودة' }, 404);

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

    const rawRef = Number(body.ref ?? 0);
    const referrer =
      Number.isFinite(rawRef) && rawRef > 0 && rawRef !== auth.id ? rawRef : null;

    const { error } = await db.from('gm_gift_entries').insert({
      gift_id: giftId,
      telegram_id: auth.id,
      chances: 1,
      referred_by: referrer,
    });
    if (error && !String(error.message).includes('duplicate'))
      return json({ error: error.message }, 500);

    // Credit the inviter one extra chance — only if they already joined.
    if (referrer) {
      const { data: refRow } = await db
        .from('gm_gift_entries')
        .select('id,chances,invited_count')
        .eq('gift_id', giftId)
        .eq('telegram_id', referrer)
        .maybeSingle();
      if (refRow) {
        await db
          .from('gm_gift_entries')
          .update({
            chances: Number(refRow.chances ?? 1) + 1,
            invited_count: Number(refRow.invited_count ?? 0) + 1,
          })
          .eq('id', refRow.id);
      }
    }
  }

  return json(await getGiftState(initData));
}
