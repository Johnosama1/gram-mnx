import { getSetting } from '@/lib/admin.server';

/**
 * Single source of truth for the rewarded-ad admin-configurable settings
 * (gm_settings key/value store, no schema needed). Every screen that shows
 * or gates behind an ad reads through these helpers instead of its own
 * copy, so the toggles can never drift out of sync between screens.
 *
 * Two ad networks are in use, split by placement:
 *  - Monetag: the "Watch & Earn" task, Daily Check-in, and the task-claim
 *    gate (channels/Twitter/etc. task completions) — see src/lib/monetag.ts.
 *  - AdsGram (this block id): Daily Combo, the Gifts screen's ad-watching,
 *    the Bonus Ad task, and Promo Code redemption — see src/lib/adsgram.ts.
 */
export const DEFAULT_ADSGRAM_BLOCK_ID = '43943';

/** AdsGram block id — used by Combo, Gifts, Bonus Ad and Promo Code. */
export async function getAdsGramBlockId(): Promise<string> {
  const raw = await getSetting('adsgram_block_id');
  const trimmed = (raw ?? '').trim();
  return trimmed || DEFAULT_ADSGRAM_BLOCK_ID;
}

/** Daily check-in (Monetag) already always required an ad — default stays on. */
export async function isCheckinAdEnabled(): Promise<boolean> {
  return (await getSetting('checkin_ad_enabled')) !== 'false';
}

/** Combo (AdsGram) must show an ad before a correct combo is credited. */
export async function isComboAdEnabled(): Promise<boolean> {
  return (await getSetting('combo_ad_enabled')) !== 'false';
}

/** Task claims (Monetag) must trigger an ad on claim — default stays on. */
export async function isTaskClaimAdEnabled(): Promise<boolean> {
  return (await getSetting('task_claim_ad_enabled')) !== 'false';
}

/** Gifts screen's "watch more ads" ad-watching (AdsGram) — default on. */
export async function isGiftAdEnabled(): Promise<boolean> {
  return (await getSetting('gift_ad_enabled')) !== 'false';
}
