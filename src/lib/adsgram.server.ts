import { getSetting } from '@/lib/admin.server';

/**
 * Single source of truth for the AdsGram integration's admin-configurable
 * settings (gm_settings key/value store, no schema needed). Every screen
 * that shows or gates behind an AdsGram ad reads through these helpers
 * instead of its own copy, so the block id and per-placement toggles can
 * never drift out of sync between Tasks, Daily Check-in and Daily Combo.
 */
export const DEFAULT_ADSGRAM_BLOCK_ID = '43843';

export async function getAdsGramBlockId(): Promise<string> {
  const raw = await getSetting('adsgram_block_id');
  const trimmed = (raw ?? '').trim();
  return trimmed || DEFAULT_ADSGRAM_BLOCK_ID;
}

/** Daily check-in already always required an ad — default stays on. */
export async function isCheckinAdEnabled(): Promise<boolean> {
  return (await getSetting('checkin_ad_enabled')) !== 'false';
}

/** New gate, opt-in: combo never required an ad before, default stays off. */
export async function isComboAdEnabled(): Promise<boolean> {
  return (await getSetting('combo_ad_enabled')) === 'true';
}

/** New gate, opt-in: task claims never required an ad before, default off. */
export async function isTaskClaimAdEnabled(): Promise<boolean> {
  return (await getSetting('task_claim_ad_enabled')) === 'true';
}
