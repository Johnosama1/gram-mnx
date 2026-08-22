/**
 * Client-side trigger for the AdsGram rewarded-ad SDK. The SDK script itself
 * is declared once in src/routes/__root.tsx's `head()` scripts array, so
 * every page load gets exactly one <script> tag — this module only waits
 * for the `Adsgram` global it exposes and calls it.
 *
 * The block id is admin-configurable (default 43943) and passed in at call
 * time rather than baked in, since it can change from the admin panel
 * without a redeploy.
 */
type AdsgramController = { show: () => Promise<unknown> };
type AdsgramSdk = { init: (opts: { blockId: string }) => AdsgramController };

/** Polls for the SDK-provided global object; the script tag is async. */
function waitForAdsgramSdk(timeoutMs = 8000): Promise<AdsgramSdk> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      const sdk = (window as unknown as Record<string, unknown>)['Adsgram'];
      if (sdk && typeof (sdk as AdsgramSdk).init === 'function') {
        resolve(sdk as AdsgramSdk);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error('adsgram_unavailable'));
        return;
      }
      setTimeout(check, 150);
    };
    check();
  });
}

// One controller per block id — AdsgramSdk.init() is meant to be called once
// per placement, not on every show().
const controllers = new Map<string, AdsgramController>();

async function getController(blockId: string): Promise<AdsgramController> {
  const existing = controllers.get(blockId);
  if (existing) return existing;
  const sdk = await waitForAdsgramSdk();
  const controller = sdk.init({ blockId });
  controllers.set(blockId, controller);
  return controller;
}

/**
 * Shows an AdsGram rewarded ad and resolves only once the SDK's own promise
 * resolves (that is the official completion signal — a skipped/failed ad
 * rejects it). Same generous safety net as the existing Monetag helper
 * (src/lib/monetag.ts): the ad can legitimately run for a while, so we don't
 * race it against a short timeout, only a long one that also pauses while
 * the tab is hidden.
 */
const SAFETY_TIMEOUT_MS = 10 * 60_000;

/**
 * Warms up the AdsGram controller for a block id (separate from the Monetag
 * initialization — the two providers are never interchangeable). Never throws.
 */
export function initAdsgram(blockId: string): void {
  getController(blockId).catch(() => undefined);
}

export async function showAdsgramAd(blockId: string): Promise<void> {

  const controller = await getController(blockId);

  let settled = false;
  const adPromise = Promise.resolve(controller.show()).then(() => {
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
        reject(new Error('adsgram_timeout'));
        return;
      }
      setTimeout(tick, 1000);
    };
    setTimeout(tick, 1000);
  });

  await Promise.race([adPromise, safety]);
}
