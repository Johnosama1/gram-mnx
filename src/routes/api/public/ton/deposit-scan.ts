import { createFileRoute } from '@tanstack/react-router';
import { json } from '@/lib/admin.server';
import { scanDeposits } from '@/lib/deposit-scan.server';

/**
 * Public deposit watcher endpoint (for cron / external schedulers).
 * Read-only for callers: it never returns user data, only counters.
 */
async function run() {
  // This endpoint must stay callable by the external scheduler (no shared
  // secret is configured on it), so it is protected by a global throttle:
  // legitimate cron traffic is well under this, while an attacker cannot use
  // it to hammer the payout queue or force concurrent payout processing.
  const { rateLimit, tooMany } = await import('@/lib/rate-limit.server');
  if (!(await rateLimit('deposit-scan', 6, 60))) return tooMany('busy');

  // Recover withdrawals whose payout attempt was interrupted (e.g. the user
  // closed the withdraw screen mid-request) before they can go stale forever
  // in `processing`, then drain the pending withdrawal queue with whatever
  // balance is now available (oldest requests first). Runs independently of
  // the deposit scan below so a deposit-scan hiccup never stalls this queue.
  let withdrawals: unknown = null;
  try {
    const { recoverStaleWithdrawals, processPendingWithdrawals } = await import(
      '@/lib/withdraw-review.server'
    );
    const recovery = await recoverStaleWithdrawals();
    const queue = await processPendingWithdrawals(25);
    withdrawals = { ...queue, ...recovery };
  } catch (e) {
    console.error('processPendingWithdrawals failed:', e);
  }

  try {
    const result = await scanDeposits(50);
    return json({ ok: true, ...result, withdrawals });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : 'scan failed', withdrawals }, 500);
  }
}

export const Route = createFileRoute('/api/public/ton/deposit-scan')({
  server: { handlers: { GET: () => run(), POST: () => run() } },
});
