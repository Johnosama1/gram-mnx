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
 * Shows a Monetag rewarded ad and resolves only once the SDK's own promise
 * resolves (that is the official completion signal — a skipped/failed ad
 * rejects it). We deliberately do NOT race it against a short app-side
 * timeout: the ad itself can legitimately run for minutes, and the previous
 * 20s race reported `monetag_timeout` even though the user finished watching.
 * The only guard left is a very long safety net that also pauses while the
 * tab is hidden (the ad usually opens in another tab/window), so a genuinely
 * stuck SDK still can't hang the button forever.
 */
const SAFETY_TIMEOUT_MS = 10 * 60_000;

/**
 * Warms up the Monetag SDK (kept deliberately separate from the AdsGram
 * initialization so the two providers never share state). Call it when a
 * screen that can show a Monetag ad mounts; it never throws.
 */
export function initMonetag(): void {
  waitForMonetagFn(15_000).catch(() => undefined);
}

export async function showMonetagAd(): Promise<void> {
  const show = await waitForMonetagFn();


  let settled = false;
  const adPromise = Promise.resolve(show()).then(() => {
    settled = true;
  });

  const safety = new Promise<never>((_, reject) => {
    const startedAt = Date.now();
    let hiddenMs = 0;
    let hiddenAt = document.visibilityState === 'hidden' ? Date.now() : 0;
    const onVis = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else if (hiddenAt) {
        hiddenMs += Date.now() - hiddenAt;
        hiddenAt = 0;
      }
    };
    document.addEventListener('visibilitychange', onVis);
    const tick = () => {
      if (settled) {
        document.removeEventListener('visibilitychange', onVis);
        return;
      }
      const pausedNow = hiddenAt ? Date.now() - hiddenAt : 0;
      if (Date.now() - startedAt - hiddenMs - pausedNow >= SAFETY_TIMEOUT_MS) {
        document.removeEventListener('visibilitychange', onVis);
        reject(new Error('monetag_timeout'));
        return;
      }
      setTimeout(tick, 1000);
    };
    setTimeout(tick, 1000);
  });

  await Promise.race([adPromise, safety]);
}

