import { showRewardedAd } from '@/lib/adsgram';

export type AdGateResult = 'ok' | 'skip' | 'error';

/**
 * Rewarded-video gate for once-a-day actions (daily check-in / daily combo).
 *
 * These ads are NOT part of the 20 ads/24h quota — that quota belongs only to
 * the "Watch & Earn" task. Nothing is logged and no coins are credited here:
 * the ad must simply be completed before the action's own reward is granted.
 */
export async function runAdGate(
  _t?: (key: string, vars?: Record<string, string>) => string,
): Promise<AdGateResult> {
  const outcome = await showRewardedAd();
  if (outcome === 'reward') return 'ok';
  return outcome === 'skip' ? 'skip' : 'error';
}
