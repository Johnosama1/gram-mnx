/**
 * AdsGram Rewarded Video service for Telegram Mini Apps.
 *
 * Compliance rules enforced here (AdsGram approval requirements):
 *  - The SDK is only initialised; NO ad is ever requested automatically.
 *  - `showRewardedAd()` must be called from an explicit user click on a
 *    "Watch Ad for Reward" button — there is no timer / auto-trigger path.
 *  - Callbacks (onReward / onSkip / onError) always fire exactly once so the
 *    UI never freezes and the reward is granted only on a completed ad.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

interface ShowPromiseResult {
  done: boolean;
  error?: boolean;
  state?: string;
  description?: string;
}

interface AdController {
  show: () => Promise<ShowPromiseResult>;
  destroy?: () => void;
}

declare global {
  interface Window {
    Adsgram?: {
      init: (options: { blockId: string; debug?: boolean }) => AdController;
    };
  }
}

const SDK_URL = 'https://sad.adsgram.ai/js/sad.min.js';
const SCRIPT_ID = 'adsgram-sdk';

export const ADSGRAM_BLOCK_ID: string =
  (import.meta.env.VITE_ADSGRAM_BLOCK_ID as string | undefined) ?? '41146';

/** Loads the SDK if the document didn't already include it. Never throws. */
function loadSdkScript(): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
  if (existing || window.Adsgram) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const s = document.createElement('script');
    s.id = SCRIPT_ID;
    s.src = SDK_URL;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => resolve(); // resolved: readiness is polled below
    document.head.appendChild(s);
  });
}

/** Waits until `window.Adsgram` is available. Resolves false on timeout. */
async function waitForSdk(timeoutMs = 6000): Promise<boolean> {
  const start = Date.now();
  while (!window.Adsgram) {
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
  return true;
}

let controller: AdController | null = null;
let initPromise: Promise<AdController | null> | null = null;

/** Creates (once) the single AdsGram controller. No ad request is made here. */
export function initAdsGram(): Promise<AdController | null> {
  if (controller) return Promise.resolve(controller);
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      await loadSdkScript();
      const ready = await waitForSdk();
      if (!ready || !window.Adsgram) return null;
      controller = window.Adsgram.init({ blockId: ADSGRAM_BLOCK_ID });
      return controller;
    } catch {
      return null;
    } finally {
      initPromise = null;
    }
  })();
  return initPromise;
}

export type RewardedAdOutcome = 'reward' | 'skip' | 'error';

export interface RewardedAdHandlers {
  /** Ad watched to the end — safe to grant the reward. */
  onReward?: () => void | Promise<void>;
  /** User closed the ad early / no ad was available. No reward. */
  onSkip?: (reason: string) => void;
  /** SDK or network failure. No reward, UI must stay responsive. */
  onError?: (reason: string) => void;
}

function describe(e: unknown): string {
  if (e && typeof e === 'object' && 'description' in e) {
    return String((e as ShowPromiseResult).description ?? 'ad_error');
  }
  return e instanceof Error ? e.message : String(e ?? 'ad_error');
}

/**
 * Shows one rewarded video. MUST be invoked from a user click.
 * Always resolves (never rejects) with the outcome.
 */
export async function showRewardedAd(
  handlers: RewardedAdHandlers = {},
): Promise<RewardedAdOutcome> {
  const ctrl = await initAdsGram();
  if (!ctrl) {
    handlers.onError?.('sdk_unavailable');
    return 'error';
  }

  try {
    const result = await ctrl.show();
    if (result?.done) {
      await handlers.onReward?.();
      return 'reward';
    }
    handlers.onSkip?.(result?.description ?? 'ad_not_completed');
    return 'skip';
  } catch (e) {
    const reason = describe(e);
    const lower = reason.toLowerCase();
    if (lower.includes('skip') || lower.includes('closed') || lower.includes('cancel')) {
      handlers.onSkip?.(reason);
      return 'skip';
    }
    handlers.onError?.(reason);
    return 'error';
  }
}

export interface UseRewardedAdResult {
  /** Show the ad — call from an onClick handler only. */
  showAd: (handlers?: RewardedAdHandlers) => Promise<RewardedAdOutcome>;
  /** True while an ad request/playback is in flight (disable the button). */
  loading: boolean;
  /** True when a block id is configured. */
  configured: boolean;
}

/** React helper for the "Watch Ad for Reward" button. */
export function useRewardedAd(): UseRewardedAdResult {
  const configured = Boolean(ADSGRAM_BLOCK_ID);
  const busy = useRef(false);
  const [loading, setLoading] = useState(false);

  // Initialise the SDK only (no ad request) so the first click is fast.
  useEffect(() => {
    if (!configured) return;
    void initAdsGram();
  }, [configured]);

  const showAd = useCallback(
    async (handlers: RewardedAdHandlers = {}): Promise<RewardedAdOutcome> => {
      if (busy.current) return 'error';
      busy.current = true;
      setLoading(true);
      try {
        return await showRewardedAd(handlers);
      } finally {
        busy.current = false;
        setLoading(false);
      }
    },
    [],
  );

  return { showAd, loading, configured };
}
