-- Separate view/quota ledger for the new "Bonus Ad" task card, distinct from
-- gm_ad_views (the existing "Watch & Earn" Monetag task) so the two tasks'
-- daily counters and rewards never mix.
CREATE TABLE public.gm_bonus_ad_views (
  id bigserial PRIMARY KEY,
  telegram_id bigint NOT NULL,
  coins double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gm_bonus_ad_views_user_time_idx ON public.gm_bonus_ad_views (telegram_id, created_at DESC);
GRANT ALL ON public.gm_bonus_ad_views TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.gm_bonus_ad_views_id_seq TO service_role;
ALTER TABLE public.gm_bonus_ad_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role manages bonus ad views" ON public.gm_bonus_ad_views FOR ALL TO service_role USING (true) WITH CHECK (true);
