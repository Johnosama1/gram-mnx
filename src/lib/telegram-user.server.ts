import { authenticateInitData, type TelegramAuthUser } from '@/lib/telegram-auth.server';

export const MINING_CAP_SECONDS = 86_400;

/**
 * Resolves the Telegram user from initData. Fails closed: the signature must
 * verify against the bot token, otherwise no identity is returned.
 */
export function resolveTelegramUser(initData: string | null): TelegramAuthUser | null {
  return authenticateInitData(initData);
}


export async function getDb() {
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  return supabaseAdmin;
}

type DbUser = {
  telegram_id: number;
  balance: number | null;
  coins: number | null;
  last_mining_at: string | null;
  last_claim_at?: string | null;
  mining_rate?: number | null;
  unclaimed_mining_balance?: number | null;
  is_banned?: boolean | null;
};

/** Creates the user row on first contact, then refreshes profile fields. */
export async function upsertUser(user: TelegramAuthUser & { last_name?: string }): Promise<DbUser> {
  const db = (await getDb()) as any;
  const { data, error } = await db.rpc('gm_upsert_telegram_user', {
    _telegram_id: user.id,
    _username: user.username ?? null,
    _first_name: user.first_name ?? null,
    _last_name: user.last_name ?? null,
  });
  if (error) {
    console.error('[telegram-user] atomic upsert failed', error);
    throw new Error('Failed to create or update Telegram user');
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('Telegram user upsert returned no row');
  return row as DbUser;
}

/** True when the Telegram user already has a row (i.e. has used the bot before). */
export async function userExists(telegramId: number): Promise<boolean> {
  const db = await getDb();
  const { data } = await db
    .from('gm_users')
    .select('telegram_id')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  return Boolean(data);
}

export type Accrued = {
  accrued: number;
  elapsedSeconds: number;
  cappedAt24h: boolean;
  lastMiningAt: string | null;
  coins: number;
  miningRate: number;
  /** True while a 24h mining session is running */
  miningActive: boolean;
  /** Seconds left in the current 24h session (0 when inactive/finished) */
  remainingSeconds: number;
  miningStartedAt: string | null;
  /** When false, the Start-Mining button is hidden and mining runs automatically */
  miningButtonEnabled: boolean;
  /** Admin-configurable daily mining percentage (e.g. 5 = 5%/day of coins) */
  miningDailyPct: number;
};

/**
 * Server-authoritative mining accrual: coins / 14_000 / 86_400 gram per second.
 * Mining accrues from the persistent last-claim timestamp even while the app is
 * closed. A cycle can store at most 24 hours of earnings; Claim transfers that
 * server-computed amount and opens the next cycle.
 */
export async function computeAccrued(telegramId: number): Promise<Accrued> {
  const db = await getDb();
  const { data } = await db
    .from('gm_users')
    .select('coins, last_claim_at, mining_rate, unclaimed_mining_balance')
    .eq('telegram_id', telegramId)
    .maybeSingle();

  // Admin-configurable daily mining percentage (default 5%).
  let miningDailyPct = 5;
  try {
    const { data: s } = await db
      .from('gm_settings')
      .select('value')
      .eq('key', 'mining_daily_pct')
      .maybeSingle();
    const parsed = Number((s as { value?: string } | null)?.value);
    if (Number.isFinite(parsed) && parsed >= 0) miningDailyPct = parsed;
  } catch { /* keep default */ }


  const liveCoins = Math.max(0, Number(data?.coins ?? 0) || 0);
  const row = data as {
    last_claim_at?: string | null;
    mining_rate?: number | null;
    unclaimed_mining_balance?: number | null;
  } | null;

  // The Start button is permanently retired: mining is always active.
  const miningButtonEnabled = false;

  const startedAt = row?.last_claim_at ?? new Date().toISOString();
  const storedRate = Number(row?.mining_rate);
  const miningRate = Number.isFinite(storedRate) ? Math.max(0, storedRate) : 0;

  // Lifetime mining: no 24h cap — the full elapsed time since the last claim accrues.
  const elapsedSeconds = Math.max(0, (Date.now() - new Date(startedAt).getTime()) / 1000);
  // A coins-changing reward trigger settles the old-rate accrual into this
  // durable bucket before moving the timestamp/rate forward. Including it
  // here keeps the Mine counter continuous across tasks, combos and deposits.
  const settledUnclaimed = Math.max(0, Number(row?.unclaimed_mining_balance ?? 0) || 0);
  const raw = settledUnclaimed + miningRate * elapsedSeconds;
  const accrued = Math.round(raw * 1_000_000_000_000) / 1_000_000_000_000;

  return {
    accrued: Number.isFinite(accrued) ? accrued : 0,
    elapsedSeconds,
    cappedAt24h: false,
    lastMiningAt: startedAt,
    coins: liveCoins,
    miningRate,
    miningActive: true,
    remainingSeconds: 0,
    miningStartedAt: new Date(startedAt).toISOString(),
    miningButtonEnabled,
    miningDailyPct,
  };
}

/** Welcome message: DB override (welcome_message_<lang> / welcome_message) or the English default. */
export async function getWelcomeMessage(firstName: string, lang: 'ar' | 'en'): Promise<string> {
  // Always English with the premium (custom) emoji, regardless of client language.
  const fallback = `<tg-emoji emoji-id="5339536521009571338">👋</tg-emoji> Welcome to GRAM MNX, {first_name}!\n\n<tg-emoji emoji-id="5918280894539372491">💵</tg-emoji> Start mining gram by tapping the coin!\n<tg-emoji emoji-id="5424767999515040992">🏆</tg-emoji> Compete with friends and earn rewards!\n\n<tg-emoji emoji-id="5852805286342957224">👇</tg-emoji> Press the button below to start:`;
  try {
    const db = await getDb();
    const { data } = await db
      .from('gm_settings')
      .select('key, value')
      .in('key', ['welcome_message_en', 'welcome_message']);
    const rows = data ?? [];
    const custom =
      rows.find((r) => r.key === 'welcome_message_en')?.value ??
      rows.find((r) => r.key === 'welcome_message')?.value;
    if (custom && custom.trim()) return custom.replace(/\{first_name\}/g, firstName);
  } catch {
    /* fall back to default */
  }
  return fallback.replace(/\{first_name\}/g, firstName);
}
