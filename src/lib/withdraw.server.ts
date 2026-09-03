import { json, getSetting } from '@/lib/admin.server';
import { reqLang, tr } from '@/lib/i18n.server';
import { computeAccrued, getDb, resolveTelegramUser, upsertUser } from '@/lib/telegram-user.server';
import { rateLimit } from '@/lib/rate-limit.server';

const DEFAULT_MAX_ACCOUNTS_PER_IP = 10;
const DEFAULT_MAX_ACCOUNTS_PER_WALLET = 1;
const DEFAULT_MIN_WITHDRAW = 0.1;

/**
 * Admin on/off switch for the withdrawal-unlock gate (the "make a new
 * deposit to unlock withdrawals" condition). Defaults to enabled — unset
 * means the gate behaves exactly as it does today — so an admin has to
 * explicitly turn it off from the panel to bypass it for everyone.
 */
export async function isWithdrawGateEnabled(): Promise<boolean> {
  return (await getSetting('withdraw_gate_enabled')) !== 'false';
}

/** Minimum withdrawal in gram (admin-configurable). */
export async function getMinWithdraw(): Promise<number> {
  for (const key of ['min_withdrawal', 'min_withdraw']) {
    const n = Number(await getSetting(key));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_MIN_WITHDRAW;
}

/**
 * Withdrawal ad-gate: a user must watch N rewarded ads (AdsGram) before a
 * withdrawal request is accepted. Counted from gm_bonus_ad_views — the
 * SAME ledger as the "Watch & Earn (Bonus)" task card (AdsGram) — not the
 * plain "Watch & earn" card, which runs Monetag ads and would let a user
 * satisfy this gate without ever watching an AdsGram ad.
 */
const DEFAULT_WITHDRAW_ADS_REQUIRED = 10;

/**
 * Admin switch: turn the whole withdrawal ad requirement on/off. This is a
 * brand-new precondition nobody has agreed to yet, so — unlike the other
 * withdrawal toggles above, which preserve pre-existing behavior when
 * unset — this one defaults OFF. An admin must explicitly opt in from the
 * panel; publishing this code alone never starts blocking withdrawals.
 */
export async function isWithdrawAdsEnabled(): Promise<boolean> {
  const raw = await getSetting('withdraw_ads_enabled');
  return (raw ?? '').trim().toLowerCase() === 'true';
}

export async function getWithdrawAdsRequired(): Promise<number> {
  if (!(await isWithdrawAdsEnabled())) return 0;
  const n = Number(await getSetting('withdraw_ads_required'));
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_WITHDRAW_ADS_REQUIRED;
}

/**
 * Bonus (AdsGram) ads the user watched since 00:00 UTC — reuses the exact
 * quota function the "Watch & Earn (Bonus)" task card itself uses, so this
 * gate and that task's own counter can never drift apart.
 */
export async function countAdsWatchedToday(telegramId: number): Promise<number> {
  const { getBonusAdQuota } = await import('@/lib/tasks.server');
  const db = (await getDb()) as any;
  const { watched } = await getBonusAdQuota(db, telegramId);
  return watched;
}

/** GET /api/telegram/withdraw/ads-status */
export async function handleWithdrawAdsStatus(request: Request): Promise<Response> {
  const user = resolveTelegramUser(getInitData(request));
  if (!user) return json({ message: 'Invalid initData' }, 401);
  const { getAdsGramBlockId } = await import('@/lib/adsgram.server');
  const [required, watched, blockId] = await Promise.all([
    getWithdrawAdsRequired(),
    countAdsWatchedToday(user.id),
    getAdsGramBlockId(),
  ]);
  return json({
    required,
    watched,
    remaining: Math.max(0, required - watched),
    unlocked: watched >= required,
    blockId,
  });
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
  // This is called on every /api/telegram/auth poll (every 15-20s per user
  // while the app is foregrounded) but the bookkeeping it does — an upsert
  // plus a full scan of every account sharing this IP — doesn't need
  // per-poll freshness. Throttled to once per user per window so the
  // hottest endpoint in the app isn't redoing this on nearly every request;
  // a genuinely new IP still gets recorded well within a normal session.
  if (!(await rateLimit(`ip-touch:${telegramId}`, 1, 180))) return;
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
      // Already-known (user, IP) pairing: refresh the timestamp only. The
      // set of accounts sharing this IP hasn't changed, so there is nothing
      // new for the abuse scan below to catch — skip it.
      await db.from('gm_user_ips').update({ last_seen_at: now }).eq('id', existing.id);
      return;
    }
    // A brand-new (user, IP) pairing is the only event that can change this
    // IP's shared-account count, so the abuse scan only needs to run here —
    // once per user per IP ever, not on every repeat visit.
    await db.from('gm_user_ips').insert({ telegram_id: telegramId, ip, last_seen_at: now });
    await enforceIpAccountLimit(ip);
    const { enforceMultiAccountBan } = await import('@/lib/multi-account.server');
    await enforceMultiAccountBan(telegramId);
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

  const ip = getClientIp(request);
  await Promise.all([upsertUser(user), recordUserIp(user.id, ip)]);

  const db = (await getDb()) as any;
  const { data: row, error: rowError } = await db
    .from('gm_users')
    .select('balance, wallet_address, is_banned, restrict_withdrawal, withdrawal_unlocked')
    .eq('telegram_id', user.id)
    .maybeSingle();

  // A query failure (e.g. a column missing because a migration hasn't run
  // yet) must never be reported as "account not found" — that hides a real
  // schema/DB problem behind a message that looks like a user-side issue.
  if (rowError) {
    console.error('[withdraw] failed to load user row', rowError);
    return json({ message: tr(lang, 'request_failed', { status: 'DB' }) }, 500);
  }
  if (!row) return json({ message: tr(lang, 'account_not_found') }, 404);
  if (row.is_banned) return json({ message: tr(lang, 'banned') }, 403);
  if (row.restrict_withdrawal) return json({ message: tr(lang, 'withdraw_restricted') }, 403);
  // Withdrawal-gate system: locked for everyone until a deposit confirmed
  // after the gate went live unlocks it (see finalizeDeposit in
  // deposit-scan.server.ts), or an admin unlocks it manually from the panel.
  // An admin can also turn the whole condition off from the panel, in which
  // case withdrawal_unlocked is simply never checked.
  if ((await isWithdrawGateEnabled()) && !row.withdrawal_unlocked) {
    return json({ message: tr(lang, 'withdraw_needs_deposit') }, 403);
  }
  if (!row.wallet_address) return json({ message: tr(lang, 'withdraw_link_wallet') }, 400);

  // Ad gate: N rewarded ads (AdsGram) must be watched before withdrawing.
  const adsRequired = await getWithdrawAdsRequired();
  console.log(`[withdraw] ads-gate check for ${user.id}: required=${adsRequired}`);
  if (adsRequired > 0) {
    const adsWatched = await countAdsWatchedToday(user.id);
    console.log(`[withdraw] ads-gate for ${user.id}: watched=${adsWatched} required=${adsRequired}`);
    if (adsWatched < adsRequired) {
      const remaining = adsRequired - adsWatched;
      return json(
        {
          error: 'ads_required',
          required: adsRequired,
          watched: adsWatched,
          remaining,
          message: tr(lang, 'withdraw_ads_required', { watched: adsWatched, required: adsRequired }),
        },
        403,
      );
    }
  }


  // One active request at a time: blocks duplicate submissions from a
  // double-tap or from closing and reopening the withdraw screen while an
  // earlier request is still pending/processing.
  const { data: activeRequest } = await db
    .from('gm_withdrawals')
    .select('id')
    .eq('telegram_id', user.id)
    .in('status', ['pending', 'processing'])
    .limit(1)
    .maybeSingle();
  if (activeRequest) {
    return json({ message: tr(lang, 'withdraw_already_pending') }, 409);
  }

  // Multi-account abuse guard: reject when too many accounts share this IP.
  const [limit, shared] = await Promise.all([getMaxAccountsPerIp(), countAccountsSharingIp(user.id)]);
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
  const [walletLimit, walletShared] = await Promise.all([
    getMaxAccountsPerWallet(),
    countAccountsSharingWallet(user.id, row.wallet_address),
  ]);
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

  // Every withdrawal waits for a human: no auto-payout here. The request
  // stays 'pending' and every admin gets a Telegram message with inline
  // Approve/Reject buttons (also actionable from the admin panel) — funds
  // only move once reviewWithdrawal() runs an actual approval, which is the
  // one place that calls sendTonPayout.
  const review = await import('@/lib/withdraw-review.server');
  await review.notifyAdminsPendingWithdraw({
    requestId: Number(req.id),
    telegramId: user.id,
    username: user.username ?? null,
    amount,
    wallet: row.wallet_address,
  });

  return json({ ok: true, message: tr(lang, 'withdraw_submitted'), balance: newBalance });
}

/** GET /api/telegram/withdraw/status — recent withdrawal history. */
export async function handleWithdrawStatus(request: Request) {
  const user = resolveTelegramUser(getInitData(request));
  if (!user) return json({ message: 'Invalid initData' }, 401);
  await recordUserIp(user.id, getClientIp(request));
  // Background maintenance (detached from this request): recovers rows stuck
  // in processing/recovering and drains the pending payout queue. Fire and
  // forget so the history response is never blocked by a chain call.
  const { kickWithdrawSweep } = await import('@/lib/withdraw-sweep.server');
  kickWithdrawSweep(request);

  const db = (await getDb()) as any;
  const { data } = await db
    .from('gm_withdrawals')
    .select('id, amount, status, created_at')
    .eq('telegram_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20);
  return json(data ?? []);
}
