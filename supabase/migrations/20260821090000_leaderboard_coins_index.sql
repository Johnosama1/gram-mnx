-- Speeds up the leaderboard/tournament-settlement query (ORDER BY coins DESC
-- WHERE is_banned = false AND coins > 0), which currently has no supporting
-- index and falls back to a full table scan + sort on every call. Harmless
-- at the current user count, but this query runs on every /api/leaderboard
-- request and every tournament settlement, both of which can be hit by many
-- concurrent users at once.
CREATE INDEX IF NOT EXISTS idx_gm_users_leaderboard_coins
  ON public.gm_users (coins DESC)
  WHERE is_banned = false AND coins > 0;

-- Same query shape also runs for GRAM tournaments, ordered by balance instead.
CREATE INDEX IF NOT EXISTS idx_gm_users_leaderboard_balance
  ON public.gm_users (balance DESC)
  WHERE is_banned = false AND balance > 0;
