import { json, getSetting } from '@/lib/admin.server';
import { reqLang, tr } from '@/lib/i18n.server';
import { computeAccrued, getDb, resolveTelegramUser, upsertUser } from '@/lib/telegram-user.server';
import { rateLimit } from '@/lib/rate-limit.server';

const DEFAULT_MAX_ACCOUNTS_PER_IP = 10;
const DEFAULT_MAX_ACCOUNTS_PER_WALLET = 1;
const DEFAULT_MIN_WITHDRAW = 0.1;

/** Minimum withdrawal in gram (admin-configurable). */
export async function getMinWithdraw(): Promise<number> {
  for (const key of ['min_withdrawal', 'min_withdraw']) {
    const n = Number(await getSetting(key));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_MIN_WITHDRAW;
}

function getInitData(request: Request, body?: { initData?: string }) {
  return (
    body?.initData ??
    request.headers.get('x-init-data') ??
    request.headers.get('x-telegram-initdata')
  );
}

/** Best-effort client IP behind the edge proxy. */
export function getClientIp(request: Request): string | null {
  const h = request.headers;
  const raw =
    h.get('cf-connecting-ip') ??
    h.get('x-real-ip') ??
    (h.get('x-forwarded-for') ?? '').split(',')[0];
  const ip = (raw ?? '').trim();
  return ip ? ip : null;
}

/** Records (telegram_id, ip) so multi-account abuse can be detected later. */
export async function recordUserIp(telegramId: number, ip: string | null): Promise<void> {
  if (!ip) return;
  try {
    const db = (await getDb()) as any;
    const now = new Date().toISOString();
    const { data: existing } = await db
      .from('gm_user_ips')
      .select('id')
      .eq('telegram_id', telegramId)
      .eq('ip', ip)
      .maybeSingle();
    if (existing) {
      await db.from('gm_user_ips').update({ last_seen_at: now }).eq('id', existing.id);
    } else {
      await db.from('gm_user_ips').insert({ telegram_id: telegramId, ip, last_seen_at: now });
    }
    await enforceIpAccountLimit(ip);
  } catch {
    /* never block the request on IP bookkeeping */
  }
}

/**
 * Auto-ban from withdrawals: when an IP reaches the allowed number of accounts
 * (default 10), every account seen on that IP gets `restrict_withdrawal = true`.
 */
export async function enforceIpAccountLimit(ip: string): Promise<void> {
  const db = (await getDb()) as any;
  const limit = await getMaxAccountsPerIp();
  const { data: peers } = await db.from('gm_user_ips').select('telegram_id').eq('ip', ip);
  const ids = Array.from(
    new Set(((peers ?? []) as { telegram_id: number }[]).map((r) => Number(r.telegram_id))),
  );
  if (ids.length < limit) return;
  await db
    .from('gm_users')
    .update({ restrict_withdrawal: true })
    .in('telegram_id', ids)
    .eq('restrict_withdrawal', false);
}


async function getMaxAccountsPerIp(): Promise<number> {
  const raw = await getSetting('max_accounts_per_ip');
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_ACCOUNTS_PER_IP;
}

async function getMaxAccountsPerWallet(): Promise<number> {
  const raw = await getSetting('max_accounts_per_wallet');
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_ACCOUNTS_PER_WALLET;
}

/**
 * Counts distinct accounts tied to the same withdrawal address
 * (both linked wallets and past withdrawal requests).
 */
export async function countAccountsSharingWallet(
  telegramId: number,
  wallet: string,
): Promise<number> {
  const db = (await getDb()) as any;
  const ids = new Set<number>([telegramId]);

  const { data: users } = await db
    .from('gm_users')
    .select('telegram_id')
    .ilike('wallet_address', wallet);
  for (const r of (users ?? []) as { telegram_id: number }[]) ids.add(Number(r.telegram_id));

  const { data: ws } = await db
    .from('gm_withdrawals')
    .select('telegram_id, status')
    .ilike('wallet_address', wallet);
  for (const r of (ws ?? []) as { telegram_id: number; status: string }[]) {
    if (r.status !== 'rejected') ids.add(Number(r.telegram_id));
  }

  return ids.size;
}

/**
 * Counts how many distinct accounts share any IP with this user.
 * Returns the worst (highest) count across the user's known IPs.
 */
export async function countAccountsSharingIp(telegramId: number): Promise<number> {
  const db = (await getDb()) as any;
  const { data: mine } = await db.from('gm_user_ips').select('ip').eq('telegram_id', telegramId);
  const ips: string[] = Array.from(new Set(((mine ?? []) as { ip: string }[]).map((r) => r.ip)));
  if (!ips.length) return 1;

  const { data: peers } = await db.from('gm_user_ips').select('ip, telegram_id').in('ip', ips);
  const byIp = new Map<string, Set<number>>();
  for (const r of (peers ?? []) as { ip: string; telegram_id: number }[]) {
    if (!byIp.has(r.ip)) byIp.set(r.ip, new Set());
    byIp.get(r.ip)!.add(Number(r.telegram_id));
  }
  let worst = 1;
  for (const set of byIp.values()) worst = Math.max(worst, set.size);
  return worst;
}

/** POST /api/telegram/withdraw — create a withdrawal request. */
export async function handleWithdraw(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    initData?: string;
    amount?: number;
    lang?: string;
  };
  const lang = reqLang(request, body);
  const user = resolveTelegramUser(getInitData(request, body));
  if (!user) return json({ message: 'Invalid initData' }, 401);

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return json({ message: tr(lang, 'invalid_amount') }, 400);

  // Anti-abuse / anti-replay: a burst of identical withdrawal requests is
  // rejected before any balance work happens.
  if (!(await rateLimit(`withdraw:${user.id}`, 5, 60))) {
    return json({ message: tr(lang, 'invalid_amount') }, 429);
  }

  await upsertUser(user);
  const ip = getClientIp(request);
  await recordUserIp(user.id, ip);

  const db = (await getDb()) as any;
  const { data: row } = await db
    .from('gm_users')
    .select('balance, wallet_address, is_banned, restrict_withdrawal')
    .eq('telegram_id', user.id)
    .maybeSingle();

  if (!row) return json({ message: tr(lang, 'account_not_found') }, 404);
  if (row.is_banned) return json({ message: tr(lang, 'banned') }, 403);
  if (row.restrict_withdrawal) return json({ message: tr(lang, 'withdraw_restricted') }, 403);
  if (!row.wallet_address) return json({ message: tr(lang, 'withdraw_link_wallet') }, 400);

  // Multi-account abuse guard: reject when too many accounts share this IP.
  const limit = await getMaxAccountsPerIp();
  const shared = await countAccountsSharingIp(user.id);
  if (shared >= limit) {
    await db.from('gm_withdrawals').insert({
      telegram_id: user.id,
      wallet_address: row.wallet_address,
      amount,
      status: 'rejected',
      rejection_reason: `multi-account: ${shared} accounts share the same IP (limit ${limit})`,
      processed_at: new Date().toISOString(),
    });
    return json(
      {
        message: tr(lang, 'withdraw_multi_account', { shared, limit }),
      },
      403,
    );
  }

  // Same-address abuse guard: reject when several accounts withdraw to one wallet.
  const walletLimit = await getMaxAccountsPerWallet();
  const walletShared = await countAccountsSharingWallet(user.id, row.wallet_address);
  if (walletShared > walletLimit) {
    await db.from('gm_withdrawals').insert({
      telegram_id: user.id,
      wallet_address: row.wallet_address,
      amount,
      status: 'rejected',
      rejection_reason: `duplicate wallet: ${walletShared} accounts use the same withdrawal address (limit ${walletLimit})`,
      processed_at: new Date().toISOString(),
    });
    return json(
      {
        message: tr(lang, 'withdraw_duplicate_wallet', { shared: walletShared, limit: walletLimit }),
      },
      403,
    );
  }

  // The UI shows stored balance + live mining accrual. Settle that accrual into
  // the DB balance first, otherwise a withdrawal of a visible amount fails with
  // "insufficient balance" just because the mined part was never claimed.
  let balance = Number(row.balance ?? 0);
  try {
    const { accrued } = await computeAccrued(user.id);
    const claimed = Math.round(Number(accrued) * 1_000_000_000_000) / 1_000_000_000_000;
    if (Number.isFinite(claimed) && claimed > 0) {
      const settled = Math.round((balance + claimed) * 1_000_000_000_000) / 1_000_000_000_000;
      const now = new Date().toISOString();
      const { error: settleError } = await db
        .from('gm_users')
        .update({ balance: settled, last_mining_at: now, mining_started_at: now, mining_coins: null })
        .eq('telegram_id', user.id);
      if (!settleError) {
        balance = settled;
        await db
          .from('gm_earnings_log')
          .insert({ telegram_id: user.id, amount: claimed })
          .then(() => undefined, () => undefined);
      }
    }
  } catch {
    /* never block a withdrawal on accrual bookkeeping */
  }
  if (amount > balance + 1e-12) {
    return json(
      {
        message: tr(lang, 'withdraw_insufficient', { balance: balance.toFixed(4), amount: amount.toFixed(4) }),
        balance,
      },
      400,
    );
  }

  const min = await getMinWithdraw();
  if (amount < min) return json({ message: tr(lang, 'min_withdraw', { min }) }, 400);

  // Atomic, row-locked debit: the balance re-check and the deduction happen in
  // one transaction, so two concurrent withdrawals cannot both be funded from
  // the same balance (double-spend / race condition).
  const { data: debited } = await db.rpc('gm_debit_balance', {
    _telegram_id: user.id,
    _amount: amount,
  });
  if (debited === null || debited === undefined) {
    return json(
      {
        message: tr(lang, 'withdraw_insufficient', { balance: balance.toFixed(4), amount: amount.toFixed(4) }),
        balance,
      },
      400,
    );
  }
  const newBalance = Number(debited);
  const { data: req, error: requestError } = await db
    .from('gm_withdrawals')
    .insert({
      telegram_id: user.id,
      wallet_address: row.wallet_address,
      amount,
      status: 'pending',
    })
    .select('id')
    .maybeSingle();

  if (requestError || !req?.id) {
    await db.rpc('gm_add_balance', { _telegram_id: user.id, _amount: amount });
    return json({ message: tr(lang, 'withdraw_create_failed') }, 500);
  }

  // No channel post while the request is pending — the withdrawal is only
  // announced in the channel after the payout actually succeeds.



  // Automatic payout: when a payout wallet is configured the funds are sent
  // immediately and the admins only receive a notification (no approval step).
  const { hasPayoutWallet } = await import('@/lib/ton.server');
  const review = await import('@/lib/withdraw-review.server');
  // The payout helper itself picks the correct wallet version (V5R1/V4/V3R2)
  // and only sends from a funded wallet, so no address match gate is needed.
  const autoPayoutReady = await hasPayoutWallet();
  if (autoPayoutReady) {
    const result = await review.reviewWithdrawal(Number(req.id), 'approve', undefined, {
      id: null,
      name: 'Auto payout',
    });
    if (result.ok) {
      return json({
        ok: true,
        message: tr(lang, 'withdraw_sent'),
        balance: newBalance,
      });
    }
    // Payout wallet out of funds → do NOT tell the user "no funds". Keep the
    // request pending, notify the admins, and show a normal "under review"
    // message. The amount stays reserved (already deducted) so the admin can
    // approve it later once the payout wallet is topped up.
    const rawMsg = String(result.message ?? '');
    const isInsufficientFunds =
      rawMsg.toLowerCase().includes('too low') ||
      rawMsg.toLowerCase().includes('insufficient') ||
      rawMsg.toLowerCase().includes('not enough');

    if (isInsufficientFunds) {
      await db
        .from('gm_withdrawals')
        .update({ status: 'pending', rejection_reason: null })
        .eq('id', Number(req.id));
      await review.notifyAdminsPendingWithdraw({
        requestId: Number(req.id),
        telegramId: user.id,
        username: user.username ?? null,
        amount,
        wallet: row.wallet_address,
        note: `⚠️ Payout wallet balance is too low — the request is waiting for manual review. (${rawMsg})`,
      });
      return json({
        ok: true,
        message: tr(lang, 'withdraw_pending_admin'),
        balance: newBalance,
      });
    }

    // Any other payout failure: refund immediately so the user's money is not
    // stuck reserved on a request that can never be retried automatically.
    const failureReason = `Automatic GRAM transfer failed: ${result.message}`;
    await db
      .from('gm_withdrawals')
      .update({
        status: 'rejected',
        rejection_reason: failureReason,
        processed_at: new Date().toISOString(),
      })
      .eq('id', Number(req.id))
      .eq('status', 'pending');
    await db.rpc('gm_add_balance', { _telegram_id: user.id, _amount: amount });
    await review.notifyAdminsPendingWithdraw({
      requestId: Number(req.id),
      telegramId: user.id,
      username: user.username ?? null,
      amount,
      wallet: row.wallet_address,
      note: `${failureReason} — the amount was returned to the user's balance.`,
    });
    return json(
      {
        message: tr(lang, 'withdraw_auto_failed', { reason: String(result.message ?? '') }),
        balance,
      },
      400,
    );

  }

  // Missing or mismatched payout wallet → never broadcast from the wrong wallet.
  await review.notifyAdminsPendingWithdraw({
    requestId: Number(req.id),
    telegramId: user.id,
    username: user.username ?? null,
    amount,
    wallet: row.wallet_address,
    note: (await hasPayoutWallet())
      ? 'Automatic payouts are disabled: the payout wallet key does not match the configured deposit wallet address.'
      : undefined,
  });

  return json({ ok: true, message: tr(lang, 'withdraw_submitted'), balance: newBalance });
}

/** GET /api/telegram/withdraw/status — recent withdrawal history. */
export async function handleWithdrawStatus(request: Request) {
  const user = resolveTelegramUser(getInitData(request));
  if (!user) return json({ message: 'Invalid initData' }, 401);
  await recordUserIp(user.id, getClientIp(request));
  const db = (await getDb()) as any;
  const { data } = await db
    .from('gm_withdrawals')
    .select('id, amount, status, created_at')
    .eq('telegram_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20);
  return json(data ?? []);
}

/** Exposed so other endpoints can keep IP records fresh. */
export async function touchIpFromRequest(request: Request, telegramId: number) {
  await recordUserIp(telegramId, getClientIp(request));
}