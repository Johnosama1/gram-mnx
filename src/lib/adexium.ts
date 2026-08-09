import { toast } from 'sonner';

/**
 * Adexium interstitial ads for the Telegram Mini App.
 *
 * Flow: the user taps a reward button → `adGate()` shows an interstitial (if
 * one is available) → as soon as the ad is closed (or fails / times out) the
 * promise resolves and the caller grants the reward.
 *
 * `adGate()` NEVER rejects and never blocks for long: if the SDK is missing,
 * blocked, or slow, it resolves immediately so the reward is still granted.
 */

interface AdexiumWidgetInstance {
  requestAd: (format: string) => void;
  displayAd: (ad: unknown) => void;
  on: (event: string, cb: (payload?: unknown) => void) => void;
}

declare global {
  interface Window {
    showAdexiumAd?: () => Promise<void>;
    AdexiumWidget?: new (opts: {
      wid: string;
      adFormat?: string;
      debug?: boolean;
      sdk?: string;
    }) => AdexiumWidgetInstance;
  }
}

// Official Adexium Telegram Mini Apps widget bundle.
const SDK_URL = 'https://cdn.techtg.space/assets/js/tg-ads-co-widget.min.js';
const SCRIPT_ID = 'adexium-sdk';

/** Max time to wait for an ad to arrive before giving up and rewarding. */
const AD_WAIT_MS = 1800;
/** Hard cap between tapping Claim and the ad appearing (2s, per spec). */
const SHOW_TIMEOUT_MS = 2000;
/** Absolute cap on the whole gate, so the reward is never blocked. */
const GATE_TIMEOUT_MS = 30_000;

export const ADEXIUM_WID: string =
  (import.meta.env.VITE_ADEXIUM_WID as string | undefined) ??
  '8ab48993-3825-4ff6-b7be-8fcd67f4d28a';

let widget: AdexiumWidgetInstance | null = null;
let pendingAd: unknown = null;
let initPromise: Promise<AdexiumWidgetInstance | null> | null = null;
/** Resolver for the currently displayed ad (set while an ad is on screen). */
let closeResolver: (() => void) | null = null;

function resolveClose() {
  const r = closeResolver;
  closeResolver = null;
  if (r) r();
}

function loadSdk(): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  if (window.AdexiumWidget) return Promise.resolve();
  const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
  if (existing) {
    return new Promise((resolve) => {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => resolve(), { once: true });
      setTimeout(resolve, 4000);
    });
  }
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.id = SCRIPT_ID;
    s.src = SDK_URL;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.head.appendChild(s);
  });
}

async function waitForSdk(timeoutMs = 6000): Promise<boolean> {
  const start = Date.now();
  while (!window.AdexiumWidget) {
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
  return true;
}

/** Ask Adexium for the next interstitial so it is ready when needed. */
function prefetch(w: AdexiumWidgetInstance) {
  try {
    w.requestAd('interstitial');
  } catch {
    /* ignore */
  }
}

export function initAdexium(): Promise<AdexiumWidgetInstance | null> {
  if (widget) return Promise.resolve(widget);
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      if (typeof window === 'undefined') return null;
      await loadSdk();
      const ready = await waitForSdk();
      if (!ready || !window.AdexiumWidget) return null;
      const w = new window.AdexiumWidget({
        wid: ADEXIUM_WID,
        adFormat: 'interstitial',
        debug: false,
      });
      w.on('adReceived', (ad: unknown) => {
        pendingAd = ad;
      });
      w.on('noAdFound', () => {
        pendingAd = null;
        resolveClose();
      });
      w.on('adError', () => {
        pendingAd = null;
        resolveClose();
      });
      w.on('adClosed', () => {
        pendingAd = null;
        resolveClose();
        prefetch(w);
      });
      widget = w;
      prefetch(w);
      return w;
    } catch {
      return null;
    } finally {
      initPromise = null;
    }
  })();
  return initPromise;
}

/**
 * Shows an interstitial if one is available. Never throws.
 * Resolves `true` when an ad was actually displayed.
 */
export async function showInterstitial(): Promise<boolean> {
  try {
    const w = await initAdexium();
    if (!w) return false;
    const waitFor = async (ms: number) => {
      const start = Date.now();
      while (!pendingAd && Date.now() - start < ms) {
        await new Promise((r) => setTimeout(r, 100));
      }
    };
    if (!pendingAd) {
      prefetch(w);
      await waitFor(AD_WAIT_MS / 2);
    }
    if (!pendingAd) {
      // Second attempt: the first request may have raced the SDK handshake.
      prefetch(w);
      await waitFor(AD_WAIT_MS / 2);
    }
    if (!pendingAd) return false;
    const ad = pendingAd;
    pendingAd = null;
    w.displayAd(ad);
    return true;
  } catch {
    return false;
  }
}

/**
 * Gate a reward behind an interstitial: shows the ad, waits until it is closed,
 * then resolves. Resolves immediately when no ad can be shown, and is capped by
 * a hard timeout so the reward flow can never freeze.
 */
export async function adGate(): Promise<void> {
  try {
    if (typeof window === 'undefined') return;
    if (typeof window.AdexiumWidget !== 'function') {
      toast.error('Adexium SDK not loaded');
      return;
    }
    const closed = new Promise<void>((resolve) => {
      closeResolver = resolve;
    });
    // Strict 2s budget: if the ad is not on screen by then, reward immediately.
    const shown = await Promise.race([
      showInterstitial(),
      new Promise<boolean>((r) => setTimeout(() => r(false), SHOW_TIMEOUT_MS)),
    ]);
    if (!shown) {
      closeResolver = null;
      toast.info('No ads currently available');
      return;
    }
    await Promise.race([
      closed,
      new Promise<void>((r) => setTimeout(r, GATE_TIMEOUT_MS)),
    ]);
    closeResolver = null;
  } catch {
    closeResolver = null;
    toast.info('No ads currently available');
  }
}

/**
 * Manual, user-triggered interstitial. Resolves when the ad closes, rejects if
 * no ad could be shown. Never used by core Claim buttons — only by the
 * dedicated "Watch Ad" entry point.
 */
export async function showAdexiumAd(): Promise<void> {
  if (typeof window === 'undefined') throw new Error('no window');
  if (typeof window.AdexiumWidget !== 'function') {
    toast.error('Adexium SDK not loaded');
    throw new Error('Adexium SDK not loaded');
  }
  const closed = new Promise<void>((resolve) => {
    closeResolver = resolve;
  });
  const shown = await Promise.race([
    showInterstitial(),
    new Promise<boolean>((r) => setTimeout(() => r(false), SHOW_TIMEOUT_MS)),
  ]).catch(() => false);
  if (!shown) {
    closeResolver = null;
    toast.info('No ads currently available');
    throw new Error('no ad available');
  }
  await Promise.race([closed, new Promise<void>((r) => setTimeout(r, GATE_TIMEOUT_MS))]);
  closeResolver = null;
}

/**
 * Fire-and-forget warm-up. Never awaited by render paths: it is scheduled
 * during browser idle time so mounting a screen never waits on the ad SDK.
 */
export function warmAdexium(): void {
  if (typeof window === 'undefined') return;
  const run = () => {
    try {
      void initAdexium();
    } catch {
      /* ignore */
    }
  };
  const ric = (window as unknown as {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
  }).requestIdleCallback;
  if (typeof ric === 'function') ric(run, { timeout: 800 });
  else setTimeout(run, 200);
}

// Keep the documented manual entry point available as soon as this module loads.
if (typeof window !== 'undefined') {
  window.showAdexiumAd = showAdexiumAd;
}
