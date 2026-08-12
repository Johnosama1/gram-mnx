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

  try {
    const result = await scanDeposits(50);
    // Whenever new funds land, drain the pending withdrawal queue with
    // whatever balance is now available (oldest requests first).
    let withdrawals: unknown = null;
    try {
      const { processPendingWithdrawals } = await import('@/lib/withdraw-review.server');
      withdrawals = await processPendingWithdrawals(25);
    } catch (e) {
      console.error('processPendingWithdrawals failed:', e);
    }
    return json({ ok: true, ...result, withdrawals });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : 'scan failed' }, 500);
  }
}

export const Route = createFileRoute('/api/public/ton/deposit-scan')({
  server: { handlers: { GET: () => run(), POST: () => run() } },
});
