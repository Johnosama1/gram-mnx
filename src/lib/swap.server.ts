import { json, getSetting } from '@/lib/admin.server';
import { getDb, resolveTelegramUser, upsertUser } from '@/lib/telegram-user.server';
import { reqLang, tr } from '@/lib/i18n.server';
import { rateLimit } from '@/lib/rate-limit.server';

export const DEFAULT_GRAM_TO_COINS = 700;

function getInitData(request: Request, body?: { initData?: string }) {
  return (
    body?.initData ??
    request.headers.get('x-init-data') ??
    request.headers.get('x-telegram-initdata')
  );
}

export async function getGramToCoins(): Promise<number> {
  const n = Number(await getSetting('gram_to_coins'));
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_GRAM_TO_COINS;
}

const round12 = (n: number) => Math.round(n * 1_000_000_000_000) / 1_000_000_000_000;

/** GET /api/telegram/swap/rate */
export async function handleSwapRate() {
  return json({ gramToCoins: await getGramToCoins() });
}

/** POST /api/telegram/swap */
export async function handleSwap(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    initData?: string;
    direction?: string;
    amount?: number;
    lang?: string;
  };
  const lang = reqLang(request, body);
  const user = resolveTelegramUser(getInitData(request, body));
  if (!user) return json({ message: 'Invalid initData' }, 401);

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return json({ message: tr(lang, 'invalid_amount') }, 400);

  // Swapping is one-way only: GRAM → coin.
  if (body.direction === 'coins_to_gram') {
    return json({ message: tr(lang, 'swap_one_way') }, 400);
  }
  const direction = 'gram_to_coins' as const;

  // Abuse guard: swapping is a balance-moving operation.
  if (!(await rateLimit(`swap:${user.id}`, 20, 60))) {
    return json({ message: tr(lang, 'invalid_amount') }, 429);
  }

  const rate = await getGramToCoins();

  await upsertUser(user);
  const db = (await getDb()) as any;
  const { data: row } = await db
    .from('gm_users')
    .select('balance, coins, is_banned')
    .eq('telegram_id', user.id)
    .maybeSingle();
  if (!row) return json({ message: tr(lang, 'account_not_found') }, 404);
  if (row.is_banned) return json({ message: tr(lang, 'banned') }, 403);

  const balance = Number(row.balance ?? 0);
  const coins = Number(row.coins ?? 0);

  if (amount > balance + 1e-12) return json({ message: tr(lang, 'swap_insufficient_gram') }, 400);
  const gramAmount = amount;
  const coinsAmount = Math.floor(amount * rate);
  if (coinsAmount <= 0) return json({ message: tr(lang, 'swap_amount_too_small') }, 400);
  // Atomic, row-locked debit+credit. Two parallel swap requests can no longer
  // both pass the balance check and spend the same GRAM twice.
  const { data: swapped } = await db.rpc('gm_swap_gram_to_coins', {
    _telegram_id: user.id,
    _gram: gramAmount,
    _coins: coinsAmount,
  });
  const settled = Array.isArray(swapped) ? swapped[0] : swapped;
  if (!settled) return json({ message: tr(lang, 'swap_insufficient_gram') }, 400);
  const newBalance = Number(settled.new_balance);
  const newCoins = Number(settled.new_coins);
  await db.from('gm_swaps').insert({
    telegram_id: user.id,
    direction,
    gram_amount: gramAmount,
    coins_amount: coinsAmount,
    rate,
  });

  return json({ ok: true, balance: newBalance, coins: newCoins, rate });
}

/** GET /api/telegram/swap/history */
export async function handleSwapHistory(request: Request) {
  const user = resolveTelegramUser(getInitData(request));
  if (!user) return json({ message: 'Invalid initData' }, 401);
  const db = (await getDb()) as any;
  const { data } = await db
    .from('gm_swaps')
    .select('id, direction, gram_amount, coins_amount, created_at')
    .eq('telegram_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20);
  return json(data ?? []);
}