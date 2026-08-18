/**
 * Client-side trigger for the Monetag rewarded-ad SDK (zone 11590639). The
 * SDK script itself is declared once in src/routes/__root.tsx's `head()`
 * scripts array, so every page load gets exactly one <script> tag — this
 * module only waits for the `show_11590639` global it exposes and calls it.
 */
const MONETAG_FN = 'show_11590639';

/** Polls for the SDK-provided global function; the script tag is async. */
function waitForMonetagFn(timeoutMs = 8000): Promise<() => Promise<unknown>> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      const fn = (window as unknown as Record<string, unknown>)[MONETAG_FN];
      if (typeof fn === 'function') {
        resolve(fn as () => Promise<unknown>);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error('monetag_unavailable'));
        return;
      }
      setTimeout(check, 150);
    };
    check();
  });
}

/**
 * Shows a Monetag rewarded ad and resolves only once it was watched to
 * completion. Throws (never resolves silently) when the ad SDK isn't ready,
 * when the ad was skipped/failed, or when it never fills/settles within
 * AD_TIMEOUT_MS — the SDK's own promise has no built-in timeout, and without
 * one a no-fill can leave the caller awaiting forever with no way to show
 * an error or re-enable its button. Callers must not credit a reward unless
 * this resolves.
 */
const AD_TIMEOUT_MS = 20_000;

export async function showMonetagAd(): Promise<void> {
  const show = await waitForMonetagFn();
  await Promise.race([
    show(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('monetag_timeout')), AD_TIMEOUT_MS),
    ),
  ]);
}
