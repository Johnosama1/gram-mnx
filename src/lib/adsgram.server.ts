import { getSetting } from '@/lib/admin.server';

/**
 * Single source of truth for the rewarded-ad admin-configurable settings
 * (gm_settings key/value store, no schema needed). Every screen that shows
 * or gates behind an ad reads through these helpers instead of its own
 * copy, so the toggles can never drift out of sync between screens.
 *
 * Two ad networks are in use, split by placement:
 *  - Monetag: the "Watch & Earn" task, the Bonus Ad task, Daily Check-in,
 *    and the task-claim gate (see src/lib/monetag.ts).
 *  - AdsGram (this block id): Daily Combo, the Gifts screen's ad-watching,
 *    and Promo Code redemption (see src/lib/adsgram.ts).
 */
export const DEFAULT_ADSGRAM_BLOCK_ID = '43843';

/** AdsGram block id — used by Combo, Gifts and Promo Code. */
export async function getAdsGramBlockId(): Promise<string> {
  const raw = await getSetting('adsgram_block_id');
  const trimmed = (raw ?? '').trim();
  return trimmed || DEFAULT_ADSGRAM_BLOCK_ID;
}

/** Daily check-in (Monetag) already always required an ad — default stays on. */
export async function isCheckinAdEnabled(): Promise<boolean> {
  return (await getSetting('checkin_ad_enabled')) !== 'false';
}

/** Combo (AdsGram) never required an ad before — opt-in, default stays off. */
export async function isComboAdEnabled(): Promise<boolean> {
  return (await getSetting('combo_ad_enabled')) === 'true';
}

/** Task claims (Monetag) never required an ad before — opt-in, default off. */
export async function isTaskClaimAdEnabled(): Promise<boolean> {
  return (await getSetting('task_claim_ad_enabled')) === 'true';
}
