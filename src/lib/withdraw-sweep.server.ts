/**
 * Background execution helpers for withdrawals.
 *
 * The payout itself is unchanged (same amounts, same validation, same
 * `reviewWithdrawal` path). What changes here is *who keeps it alive*: the
 * work is registered with the platform's `waitUntil` when available, so it
 * keeps running after the HTTP response is sent or after the user closes the
 * withdraw screen / the bot. On top of that, a cheap sweep re-drives anything
 * that was interrupted, so nothing can stay stuck in `processing`.
 */

type CfCtx = { waitUntil?: (p: Promise<unknown>) => void };

/** Best-effort lookup of the request-scoped Cloudflare execution context. */
function getExecutionCtx(): CfCtx | null {
  const g = globalThis as Record<string | symbol, any>;
  const candidates = [
    g[Symbol.for('__cloudflare-request-context__')],
    g['__cloudflare_request_context__'],
    g['__cfExecutionCtx'],
  ];
  for (const c of candidates) {
    const ctx = c?.ctx ?? c?.executionCtx ?? c;
    if (ctx && typeof ctx.waitUntil === 'function') return ctx as CfCtx;
  }
  return null;
}

/**
 * Runs `run()` detached from the caller's request lifecycle. Returns the
 * promise so callers that *want* to await it still can (the withdraw endpoint
 * does, to keep its current response messages), but if the client disconnects
 * the task keeps running to completion on the server.
 */
export function runDetached<T>(label: string, run: () => Promise<T>): Promise<T | undefined> {
  const p = Promise.resolve()
    .then(run)
    .catch((err) => {
      console.error(`${label} failed:`, err);
      return undefined;
    });
  try {
    getExecutionCtx()?.waitUntil?.(p);
  } catch {
    /* platform without waitUntil — the promise still runs */
  }
  return p;
}

/**
 * One pass of withdrawal maintenance:
 *  1. recover requests stuck in `processing`/`recovering` (checks the chain
 *     first, so an already-sent payout is recorded instead of resent),
 *  2. drain the `pending` queue with the normal payout path.
 *
 * Guarded by a short DB rate-limit window so concurrent requests can't run
 * overlapping sweeps.
 */
export async function sweepWithdrawals(staleMinutes = 2) {
  const { rateLimit } = await import('@/lib/rate-limit.server');
  // one sweep per 30s across the whole deployment
  if (!(await rateLimit('withdraw-sweep', 1, 30))) return null;

  const { recoverStaleWithdrawals, processPendingWithdrawals } = await import(
    '@/lib/withdraw-review.server'
  );
  const recovery = await recoverStaleWithdrawals(staleMinutes);
  const queue = await processPendingWithdrawals(25);
  return { ...recovery, ...queue };
}

/** Fire-and-forget sweep for use on ordinary user endpoints. */
export function kickWithdrawSweep(staleMinutes = 2) {
  void runDetached('withdraw sweep', () => sweepWithdrawals(staleMinutes));
}
