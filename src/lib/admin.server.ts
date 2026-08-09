import { createHmac } from 'node:crypto';

export type TelegramAuthUser = { id: number; username?: string; first_name?: string };

export function verifyInitData(initData: string, token: string): TelegramAuthUser | null {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(token).digest();
  const computed = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (computed !== hash) return null;
  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > 60 * 60 * 24) return null;
  const raw = params.get('user');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TelegramAuthUser;
  } catch {
    return null;
  }
}

export function parseInitDataUser(initData: string): TelegramAuthUser | null {
  try {
    const raw = new URLSearchParams(initData).get('user');
    if (!raw) return null;
    const user = JSON.parse(raw) as TelegramAuthUser;
    return user?.id ? user : null;
  } catch {
    return null;
  }
}

export function getBotToken(): string | undefined {
  return process.env.BOT_TOKEN ?? process.env.TELEGRAM_BOT_TOKEN;
}

export function getAdminIds(): number[] {
  const base = [6145230334, 868999453];
  const fromEnv = (process.env.ADMIN_ID ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => n > 0);
  return [...new Set([...base, ...fromEnv])];
}

/** Returns owners plus every admin added from the admin panel. */
export async function getAllAdminIds(): Promise<number[]> {
  const ids = new Set(getAdminIds());
  try {
    const raw = await getSetting('sub_admins');
    const admins = raw ? (JSON.parse(raw) as Array<{ telegramId?: number }>) : [];
    for (const admin of admins) {
      const id = Number(admin.telegramId);
      if (Number.isFinite(id) && id > 0) ids.add(id);
    }
  } catch {
    // Keep the configured owner IDs available if settings cannot be read.
  }
  return [...ids];
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** Verifies the caller is an admin. Returns a Response on failure. */
export async function requireAdmin(request: Request): Promise<{ user: TelegramAuthUser } | Response> {
  const initData = request.headers.get('x-telegram-initdata') ?? '';
  if (!initData) {
    // No initData at all is usually a crawler/preview hit: log quietly.
    await reportIntrusion(request, null, 'محاولة وصول لواجهة الأدمن بدون توثيق تيليجرام', 'low', false);
    return json({ error: 'Missing Telegram initData' }, 401);
  }
  const token = getBotToken();
  const user = token ? verifyInitData(initData, token) : parseInitDataUser(initData);
  if (!user) {
    await reportIntrusion(request, null, 'توقيع initData غير صالح (محاولة تزوير جلسة)', 'critical');
    return json({ error: 'Access denied' }, 403);
  }
  if (!(await getAllAdminIds()).includes(user.id)) {
    await reportIntrusion(request, user, 'مستخدم غير مصرح حاول فتح لوحة الأدمن', 'high');
    return json({ error: 'Access denied' }, 403);
  }
  return { user };
}

/** Logs + alerts on a blocked admin-panel access attempt (never throws). */
async function reportIntrusion(
  request: Request,
  user: TelegramAuthUser | null,
  detail: string,
  severity: 'low' | 'medium' | 'high' | 'critical',
  notify = true,
) {
  try {
    const { logSecurityEvent, clientIp } = await import('@/lib/security.server');
    await logSecurityEvent({
      type: 'محاولة اختراق لوحة الأدمن',
      severity,
      telegramId: user?.id ?? null,
      username: user?.username ?? null,
      ip: clientIp(request),
      path: new URL(request.url).pathname,
      detail,
      notify,
    });
  } catch {
    // logging must never break the guard
  }
}

export async function getAdminDb() {
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  return supabaseAdmin;
}

export async function notifyUser(chatId: number, text: string) {
  const token = getBotToken();
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  }).catch(() => {});
}

export async function getSetting(key: string): Promise<string | null> {
  const db = await getAdminDb();
  const { data } = await db.from('gm_settings').select('value').eq('key', key).maybeSingle();
  return (data as { value: string } | null)?.value ?? null;
}

export async function setSetting(key: string, value: string) {
  const db = await getAdminDb();
  // Primary path: upsert on the primary key.
  const { error } = await db.from('gm_settings').upsert({ key, value }, { onConflict: 'key' });
  if (!error) return;

  // Fallback for databases where the ON CONFLICT target is unavailable
  // (e.g. the unique index was not created): update, then insert.
  const upd = await db.from('gm_settings').update({ value }).eq('key', key).select('key');
  if (!upd.error && (upd.data?.length ?? 0) > 0) return;

  const ins = await db.from('gm_settings').insert({ key, value });
  if (!ins.error) return;

  throw new Error(
    `Failed to save setting "${key}": ${error.message}${upd.error ? ` | update: ${upd.error.message}` : ''} | insert: ${ins.error.message}`,
  );
}

export const DEFAULT_MINERS = [
  { id: 1, name: 'Stone Collector', baseCost: 10, dailyPct: 0.05, description: '' },
  { id: 2, name: 'Copper Miner', baseCost: 50, dailyPct: 0.05, description: '' },
  { id: 3, name: 'Ore Cart', baseCost: 250, dailyPct: 0.05, description: '' },
  { id: 4, name: 'Crystal Hunter', baseCost: 500, dailyPct: 0.05, description: '' },
  { id: 5, name: 'Forge Master', baseCost: 1000, dailyPct: 0.05, description: '' },
  { id: 6, name: 'Mining Drone', baseCost: 2000, dailyPct: 0.08, description: '' },
  { id: 7, name: 'Quantum Excavator', baseCost: 5000, dailyPct: 0.08, description: '' },
  { id: 8, name: 'Satellite Extractor', baseCost: 10000, dailyPct: 0.08, description: '' },
  { id: 9, name: 'Planet Miner', baseCost: 15000, dailyPct: 0.08, description: '' },
  { id: 10, name: 'Gram Core Reactor', baseCost: 20000, dailyPct: 0.08, description: '' },
];

export type DbTask = {
  id: number;
  title: string;
  description: string | null;
  reward: number;
  is_daily: boolean;
  is_hidden: boolean;
  channel_username: string | null;
  created_at: string;
  category?: string | null;
  bot_username?: string | null;
  twitter_url?: string | null;
  join_link?: string | null;
  slot_limit?: number | null;
};

export const mapTask = (t: DbTask) => ({
  id: t.id,
  title: t.title,
  description: t.description ?? '',
  reward: t.reward,
  isDaily: t.is_daily,
  isHidden: t.is_hidden,
  channelUsername: t.channel_username,
  category: t.category ?? 'general',
  botUsername: t.bot_username ?? null,
  twitterUrl: t.twitter_url ?? null,
  joinLink: t.join_link ?? null,
  slotLimit: t.slot_limit ?? null,
  createdAt: t.created_at,
});

export const mapChannel = (c: {
  id: number;
  channel_username: string;
  channel_name: string | null;
}) => ({ id: c.id, channelUsername: c.channel_username, channelName: c.channel_name ?? '' });

export const mapUser = (u: Record<string, unknown>) => ({
  id: u.id as number,
  telegramId: Number(u.telegram_id),
  username: (u.username as string | null) ?? null,
  firstName: (u.first_name as string | null) ?? null,
  lastName: (u.last_name as string | null) ?? null,
  balance: Number(u.balance ?? 0),
  coins: Number(u.coins ?? 0),
  isBanned: Boolean(u.is_banned),
  restrictWithdrawal: Boolean(u.restrict_withdrawal),
  blockedBot: Boolean(u.blocked_bot),
});

export const mapMilestone = (m: {
  id: number;
  invite_count: number;
  reward_coins: number;
  is_enabled: boolean;
}) => ({
  id: m.id,
  inviteCount: m.invite_count,
  rewardCoins: m.reward_coins,
  isEnabled: m.is_enabled,
});