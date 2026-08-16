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
 * or when the ad was skipped/failed — callers must not credit a reward
 * unless this resolves.
 */
export async function showMonetagAd(): Promise<void> {
  const show = await waitForMonetagFn();
  await show();
}
