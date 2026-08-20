import { json } from '@/lib/admin.server';
import { getDb, resolveTelegramUser, upsertUser } from '@/lib/telegram-user.server';
import { rateLimit } from '@/lib/rate-limit.server';

/**
 * Outbound MNX -> "gram" bot's Coin transfers, initiated from GRAM MNX's own
 * "Sending currencies" screen (mirrors the inbound API in inbound-wallet.server.ts).
 * Gated entirely on GRAM_OUTBOUND_API_KEY being configured — until the gram
 * bot team hands that over, every request cleanly reports "not linked yet"
 * instead of attempting (and failing) a real call.
 */
const GRAM_BOT_BASE_URL = 'https://gramminer.lovable.app';
const MIN_AMOUNT = 1;
const MAX_AMOUNT = 1_000_000;
const REQUEST_TIMEOUT_MS = 15_000;

function getInitData(request: Request, body?: { initData?: string }) {
  return body?.initData ?? request.headers.get('x-init-data') ?? request.headers.get('x-telegram-initdata');
}

type CreditResponse = { ok?: boolean; status?: string; error?: string; message?: string };

async function callGramBotCredit(
  apiKey: string,
  recipientId: string,
  amount: number,
  transactionId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${GRAM_BOT_BASE_URL}/api/public/wallet/credit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({
        user_id: recipientId,
        amount,
        currency: 'Coin',
        transaction_id: transactionId,
        source: 'gramMNX',
        dry_run: false,
      }),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => ({}))) as CreditResponse;
    if (res.ok && data.ok === true && data.status === 'credited') return { ok: true };
    return { ok: false, message: data.message || data.error || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'network error' };
  } finally {
    clearTimeout(timer);
  }
}

/** POST /api/telegram/wallet/send — MNX -> the linked gram bot's Coin. */
export async function handleWalletSend(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    initData?: string;
    recipientId?: string;
    amount?: number;
  };
  const user = resolveTelegramUser(getInitData(request, body));
  if (!user) return json({ ok: false, error: 'unauthorized', message: 'Invalid initData' }, 401);

  if (!(await rateLimit(`wallet-send:${user.id}`, 10, 60))) {
    return json({ ok: false, error: 'rate_limited', message: 'حاول مرة أخرى بعد قليل' }, 429);
  }

  const apiKey = process.env.GRAM_OUTBOUND_API_KEY;
  if (!apiKey) {
    return json({ ok: false, error: 'not_linked', message: 'لسه البوتين مش متربطين ببعض' }, 409);
  }

  const recipientId = String(body.recipientId ?? '').trim();
  if (!/^\d{1,20}$/.test(recipientId)) {
    return json({ ok: false, error: 'invalid_recipient', message: 'ID المستلم لازم يكون أرقام بس' }, 400);
  }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
    return json(
      { ok: false, error: 'invalid_amount', message: `المبلغ لازم يكون بين ${MIN_AMOUNT} و ${MAX_AMOUNT}` },
      400,
    );
  }

  await upsertUser(user);
  const db = (await getDb()) as any;

  // Atomic, row-locked debit — never oversells the same MNX to two parallel requests.
  const { data: spent } = await db.rpc('gm_spend_coins', { _telegram_id: user.id, _amount: amount });
  if (spent === null || spent === undefined) {
    return json({ ok: false, error: 'insufficient_balance', message: 'رصيدك مش كافي' }, 400);
  }
  const newBalance = Number(spent);

  const transactionId = crypto.randomUUID();
  await db.from('gm_outbound_transfers').insert({
    transaction_id: transactionId,
    telegram_id: user.id,
    recipient_id: recipientId,
    amount,
    status: 'pending',
  });

  const result = await callGramBotCredit(apiKey, recipientId, amount, transactionId);

  if (result.ok) {
    await db
      .from('gm_outbound_transfers')
      .update({ status: 'sent', updated_at: new Date().toISOString() })
      .eq('transaction_id', transactionId);
    return json({ ok: true, status: 'sent', transactionId, amount, newBalance });
  }

  // The other side never confirmed the credit — refund what we debited so
  // the user never loses MNX for a transfer that didn't actually land.
  const { data: refunded } = await db.rpc('gm_add_coins', { _telegram_id: user.id, _amount: amount });
  await db
    .from('gm_outbound_transfers')
    .update({ status: 'refunded', updated_at: new Date().toISOString() })
    .eq('transaction_id', transactionId);

  console.error('[outbound-wallet] gram bot credit failed, refunded', { transactionId, reason: result.message });

  return json(
    {
      ok: false,
      error: 'transfer_failed_refunded',
      message: 'Transfer failed. Your coins were refunded.',
      newBalance: Number(refunded ?? newBalance + amount),
    },
    502,
  );
}

/** GET /api/telegram/wallet/send/history */
export async function handleWalletSendHistory(request: Request): Promise<Response> {
  const user = resolveTelegramUser(getInitData(request));
  if (!user) return json({ ok: false, error: 'unauthorized', message: 'Invalid initData' }, 401);

  const db = (await getDb()) as any;
  const { data } = await db
    .from('gm_outbound_transfers')
    .select('transaction_id,recipient_id,amount,status,created_at')
    .eq('telegram_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20);

  return json(
    (data ?? []).map((r: any) => ({
      transactionId: r.transaction_id,
      recipientId: r.recipient_id,
      amount: r.amount,
      status: r.status,
      createdAt: r.created_at,
    })),
  );
}
