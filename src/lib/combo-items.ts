import comboCrystal from '@/assets/combo/crystal-v2.png.asset.json';
import comboBox from '@/assets/combo/box-v2.png.asset.json';
import comboCart from '@/assets/combo/cart-v2.png.asset.json';
import comboFlag from '@/assets/combo/flag-v2.png.asset.json';
import comboCoins from '@/assets/combo/coins-v2.png.asset.json';

/**
 * Single source of truth for the 5 daily-combo item ids. The server only
 * ever stores/compares the numeric id (gm_settings.combo_answer and the
 * gm_submit_daily_combo RPC) — every screen that shows or lets a user pick
 * combo items must import this list instead of keeping its own id→name
 * table, otherwise a display like the admin's "today's correct combo" can
 * silently drift out of sync with what users actually see and select.
 */
export const COMBO_ITEMS = [
  { id: 1, name: 'Crystal Shard', emoji: '💎', img: comboCrystal.url },
  { id: 2, name: 'GRAM Box', emoji: '🔐', img: comboBox.url },
  { id: 3, name: 'GRAM Cart', emoji: '🛒', img: comboCart.url },
  { id: 4, name: 'GRAM Flag', emoji: '🚩', img: comboFlag.url },
  { id: 5, name: 'GRAM Coins', emoji: '🪙', img: comboCoins.url },
] as const;

export const COMBO_ITEM_NAME: Record<number, string> = Object.fromEntries(
  COMBO_ITEMS.map((item) => [item.id, item.name]),
);

export const COMBO_ITEM_EMOJI: Record<number, string> = Object.fromEntries(
  COMBO_ITEMS.map((item) => [item.id, item.emoji]),
);
