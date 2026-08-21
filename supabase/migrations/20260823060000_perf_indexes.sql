-- Performance-only indexes for hot lookup paths. No data or schema changes
-- beyond adding these indexes; every existing query keeps working exactly
-- as before, just faster once the planner picks these up.

-- Wallet-address uniqueness check on every wallet-link attempt, and the
-- multi-account-per-wallet abuse check on every withdrawal request.
CREATE INDEX IF NOT EXISTS idx_gm_users_wallet_address
  ON public.gm_users (wallet_address)
  WHERE wallet_address IS NOT NULL;

-- Admin "country distribution" panel orders gm_user_ips by last_seen_at.
CREATE INDEX IF NOT EXISTS idx_gm_user_ips_last_seen_at
  ON public.gm_user_ips (last_seen_at DESC);

-- Admin dashboard "active users" count filters on last_active_at.
CREATE INDEX IF NOT EXISTS idx_gm_users_last_active_at
  ON public.gm_users (last_active_at);

-- Admin dashboard "blocked users" count filters on this OR condition.
CREATE INDEX IF NOT EXISTS idx_gm_users_blocked_banned
  ON public.gm_users (blocked_bot, is_banned)
  WHERE blocked_bot = true OR is_banned = true;

-- Promo-code "check" (dry-run validation) lookup now queries the plain
-- `code` column directly (codes are always stored upper-cased at creation),
-- instead of an ILIKE that couldn't use the existing upper(code) unique index.
CREATE INDEX IF NOT EXISTS idx_gm_promo_codes_code
  ON public.gm_promo_codes (code);
