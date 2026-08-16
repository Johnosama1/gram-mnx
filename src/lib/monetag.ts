/**
 * Client-side loader for the Monetag rewarded-ad SDK (zone 11590639). This is
 * an additional ad source alongside AdsGram — it does not touch it.
 */
const MONETAG_ZONE = '11590639';
const MONETAG_FN = `show_${MONETAG_ZONE}`;

let sdkPromise: Promise<void> | null = null;

/** Injects the Monetag SDK script at most once per page load. */
function loadMonetagSdk(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-zone="${MONETAG_ZONE}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = '//libtl.com/sdk.js';
    script.dataset.zone = MONETAG_ZONE;
    script.dataset.sdk = MONETAG_FN;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      sdkPromise = null; // allow a retry on the next attempt
      reject(new Error('monetag_sdk_failed'));
    };
    document.head.appendChild(script);
  });
  return sdkPromise;
}

/**
 * Shows a Monetag rewarded ad and resolves only once it was watched to
 * completion. Throws (never resolves silently) when the ad was skipped,
 * unavailable, or failed to load — callers must not credit a reward unless
 * this resolves.
 */
export async function showMonetagAd(): Promise<void> {
  await loadMonetagSdk();
  const show = (window as unknown as Record<string, unknown>)[MONETAG_FN];
  if (typeof show !== 'function') throw new Error('monetag_unavailable');
  await (show as () => Promise<unknown>)();
}
