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

/**
 * Nitro's cloudflare-module preset attaches the real per-request `waitUntil`
 * directly onto the incoming Request object (see
 * nitro/dist/presets/cloudflare/runtime/_module-handler.mjs — `req.waitUntil
 * = ctx.context?.waitUntil.bind(ctx.context)`, done the same way in both dev
 * and prod). There is no global registry to look this up from — it must
 * come from the specific Request this call is handling.
 */
function getWaitUntil(request: Request | undefined | null): ((p: Promise<unknown>) => void) | null {
  const fn = (request as unknown as { waitUntil?: unknown } | null)?.waitUntil;
  return typeof fn === 'function' ? (fn as (p: Promise<unknown>) => void) : null;
}

/**
 * Runs `run()` detached from the caller's request lifecycle. Returns the
 * promise so callers that *want* to await it still can (the withdraw endpoint
 * does, to keep its current response messages), but if the client disconnects
 * the task keeps running to completion on the server — as long as `request`
 * is the actual Request this call is handling, so its real waitUntil can be
 * found.
 */
export function runDetached<T>(
  label: string,
  run: () => Promise<T>,
  request?: Request | null,
): Promise<T | undefined> {
  const p = Promise.resolve()
    .then(run)
    .catch((err) => {
      console.error(`${label} failed:`, err);
      return undefined;
    });
  try {
    getWaitUntil(request)?.(p);
  } catch {
    /* platform without waitUntil — the promise still runs */
  }
  return p;
}

/**
 * One pass of withdrawal maintenance: recovers requests stuck in
 * `processing`/`recovering` (checks the chain first, so an already-sent
 * payout is recorded instead of resent).
 *
 * This does NOT auto-approve anything still `pending` — every withdrawal
 * requires an explicit admin approval (bot inline button or admin panel),
 * which is the only path that calls sendTonPayout. This sweep only
 * reconciles transfers an admin already started and that got interrupted
 * (e.g. the server process was killed mid-flight).
 *
 * Guarded by a short DB rate-limit window so concurrent requests can't run
 * overlapping sweeps.
 */
export async function sweepWithdrawals(staleMinutes = 2) {
  const { rateLimit } = await import('@/lib/rate-limit.server');
  // one sweep per 30s across the whole deployment
  if (!(await rateLimit('withdraw-sweep', 1, 30))) return null;

  const { recoverStaleWithdrawals } = await import('@/lib/withdraw-review.server');
  return recoverStaleWithdrawals(staleMinutes);
}

/** Fire-and-forget sweep for use on ordinary user endpoints. */
export function kickWithdrawSweep(request?: Request | null, staleMinutes = 2) {
  void runDetached('withdraw sweep', () => sweepWithdrawals(staleMinutes), request);
}
