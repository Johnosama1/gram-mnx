import { json } from '@/lib/admin.server';
import { getDb } from '@/lib/telegram-user.server';

/**
 * Inbound MNX credit API for the separate "gram" bot. Auth is a static
 * shared secret (x-api-key), not a Telegram user — this is a server-to-
 * server integration, never called from the Mini App client.
 */
const MIN_AMOUNT = 1;
const MAX_AMOUNT = 1_000_000;

function checkApiKey(request: Request): boolean {
  const expected = process.env.GRAM_INBOUND_API_KEY;
  if (!expected) return false;
  return request.headers.get('x-api-key') === expected;
}

function err(code: string, message: string, status: number): Response {
  return json({ ok: false, error: code, message }, status);
}

/**
 * Best-effort real-time visibility for real (non-dry-run) credit attempts —
 * there is no way to read Cloudflare/Supabase logs from outside the
 * deployed app, so this is the only diagnostic signal available once a
 * request leaves the "gram" bot's side. Never blocks or throws.
 */
async function notifyAdminsOfAttempt(text: string) {
  try {
    const { notifyUser, getAllAdminIds } = await import('@/lib/admin.server');
    const admins = await getAllAdminIds();
    await Promise.all(admins.map((id) => notifyUser(id, text)));
  } catch {
    /* best-effort */
  }
}

/** Digits-only Telegram id (as the spec requires), parsed to a safe integer. */
function parseUserId(raw: unknown): number | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const s = String(raw).trim();
  if (!/^\d{1,20}$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function isValidTransactionId(raw: unknown): raw is string {
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(raw);
}

async function rateLimitByIp(request: Request, bucket: string): Promise<Response | null> {
  const { rateLimit, tooMany } = await import('@/lib/rate-limit.server');
  const { clientIp } = await import('@/lib/security.server');
  const ip = clientIp(request) ?? 'unknown';
  // 600 req/min per IP, matching the gram bot's own outbound rate.
  if (!(await rateLimit(`${bucket}:${ip}`, 600, 60))) return tooMany('rate limited');
  return null;
}

/** POST /api/public/wallet/credit — adds MNX to a GRAM MNX user's balance. */
export async function handleWalletCredit(request: Request): Promise<Response> {
  // Every outcome of a REAL (non-dry-run) attempt is relayed to admins over
  // Telegram — the only diagnostic signal available once a request leaves
  // the gram bot's side, since Worker/DB logs aren't reachable from here.
  let dryRun = false;
  const notify = (text: string) => {
    if (!dryRun) void notifyAdminsOfAttempt(text);
  };

  if (!checkApiKey(request)) {
    notify('⚠️ inbound wallet/credit: 401 UNAUTHORIZED (bad or missing x-api-key)');
    return err('UNAUTHORIZED', 'Invalid or missing x-api-key', 401);
  }

  const limited = await rateLimitByIp(request, 'inbound-credit');
  if (limited) return limited;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  dryRun = body.dry_run === true;

  const telegramId = parseUserId(body.user_id);
  if (telegramId === null) {
    notify(`⚠️ inbound wallet/credit: 400 INVALID_USER_ID (got "${String(body.user_id)}")`);
    return err('INVALID_USER_ID', 'user_id must be a numeric Telegram id', 400);
  }

  const db = (await getDb()) as any;
  const { data: user } = await db
    .from('gm_users')
    .select('telegram_id,is_banned')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (!user) {
    notify(`⚠️ inbound wallet/credit: 404 USER_NOT_FOUND (user_id ${telegramId})`);
    return err('USER_NOT_FOUND', 'No user with this id in GRAM MNX', 404);
  }
  if (user.is_banned) {
    notify(`⚠️ inbound wallet/credit: 403 USER_BANNED (user_id ${telegramId})`);
    return err('USER_BANNED', 'User is banned', 403);
  }

  const rawAmount = Number(body.amount);
  if (!Number.isFinite(rawAmount) || rawAmount < MIN_AMOUNT || rawAmount > MAX_AMOUNT) {
    notify(`⚠️ inbound wallet/credit: 400 INVALID_AMOUNT (got "${String(body.amount)}")`);
    return err('INVALID_AMOUNT', `amount must be a number between ${MIN_AMOUNT} and ${MAX_AMOUNT}`, 400);
  }
  const amount = Math.round(rawAmount * 100) / 100;

  if (body.currency !== 'MNX') {
    notify(`⚠️ inbound wallet/credit: 400 UNSUPPORTED_CURRENCY (got "${String(body.currency)}")`);
    return err('UNSUPPORTED_CURRENCY', 'currency must be "MNX"', 400);
  }

  if (!isValidTransactionId(body.transaction_id)) {
    notify('⚠️ inbound wallet/credit: 400 INVALID_TRANSACTION_ID');
    return err(
      'INVALID_TRANSACTION_ID',
      'transaction_id is required (1-100 chars: letters, digits, "-", "_")',
      400,
    );
  }
  const transactionId = body.transaction_id;
  const source = typeof body.source === 'string' && body.source.trim() ? body.source.trim().slice(0, 60) : 'gram';

  if (dryRun) {
    const current = Number(
      (await db.from('gm_users').select('coins').eq('telegram_id', telegramId).maybeSingle()).data?.coins ?? 0,
    );
    return json({
      ok: true,
      dry_run: true,
      status: 'would_credit',
      current_balance: current,
      new_balance: Math.round((current + amount) * 100) / 100,
    });
  }

  const { data: result, error } = await db.rpc('gm_credit_inbound_mnx', {
    _transaction_id: transactionId,
    _telegram_id: telegramId,
    _amount: amount,
    _source: source,
  });
  if (error) {
    if (String(error.message).includes('user_not_found')) {
      notify(`⚠️ inbound wallet/credit: 404 USER_NOT_FOUND at RPC time (user_id ${telegramId})`);
      return err('USER_NOT_FOUND', 'No user with this id in GRAM MNX', 404);
    }
    console.error('[inbound-wallet] credit RPC failed', error);
    notify(`⚠️ inbound wallet/credit: 500 SERVER_ERROR — ${error.message}`);
    return err('SERVER_ERROR', 'Internal error — safe to retry with the same transaction_id', 500);
  }
  const settled = Array.isArray(result) ? result[0] : result;
  if (settled?.duplicate) {
    notify(`⚠️ inbound wallet/credit: 409 DUPLICATE_TRANSACTION (transaction_id ${transactionId})`);
    return err('DUPLICATE_TRANSACTION', 'transaction_id already processed', 409);
  }

  notify(
    `✅ inbound wallet/credit: credited ${amount} MNX to user_id ${telegramId} ` +
      `(transaction_id ${transactionId}, new balance ${settled?.new_balance})`,
  );
  return json({
    ok: true,
    status: 'credited',
    transaction_id: transactionId,
    user_id: String(telegramId),
    amount,
    new_balance: Number(settled?.new_balance ?? 0),
  });
}

/** GET /api/public/wallet/user/:userId — checks whether a user exists / can receive. */
export async function handleWalletUserLookup(request: Request, rawUserId: string): Promise<Response> {
  if (!checkApiKey(request)) return err('UNAUTHORIZED', 'Invalid or missing x-api-key', 401);

  const limited = await rateLimitByIp(request, 'inbound-lookup');
  if (limited) return limited;

  const telegramId = parseUserId(rawUserId);
  if (telegramId === null) return json({ ok: true, exists: false });

  const db = (await getDb()) as any;
  const { data: user } = await db
    .from('gm_users')
    .select('telegram_id,username,first_name,last_name,is_banned')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (!user) return json({ ok: true, exists: false });

  const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || null;
  return json({
    ok: true,
    exists: true,
    user_id: String(user.telegram_id),
    username: user.username ?? null,
    name,
    can_receive: !user.is_banned,
  });
}
