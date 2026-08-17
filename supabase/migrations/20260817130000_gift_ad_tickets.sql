-- Ads-gifts system: fully independent of the referral-link gift contests.
-- Each ad view (via the Gifts screen's own "watch ad" button) is logged
-- here, separately from gm_ad_views (which backs the Tasks "Watch & Earn"
-- coin reward and must not be conflated with this ticket mechanic).
CREATE TABLE public.gm_gift_ad_views (
  id bigserial PRIMARY KEY,
  telegram_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gm_gift_ad_views_user_time_idx ON public.gm_gift_ad_views (telegram_id, created_at DESC);
GRANT ALL ON public.gm_gift_ad_views TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.gm_gift_ad_views_id_seq TO service_role;
ALTER TABLE public.gm_gift_ad_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role manages gift ad views" ON public.gm_gift_ad_views FOR ALL TO service_role USING (true) WITH CHECK (true);

-- One row per user per UTC day once they hit the daily ad-watch target —
-- the unique constraint is what caps this at exactly one ticket per day.
CREATE TABLE public.gm_gift_ad_tickets (
  id bigserial PRIMARY KEY,
  telegram_id bigint NOT NULL,
  ticket_day date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (telegram_id, ticket_day)
);
CREATE INDEX gm_gift_ad_tickets_user_idx ON public.gm_gift_ad_tickets (telegram_id);
GRANT ALL ON public.gm_gift_ad_tickets TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.gm_gift_ad_tickets_id_seq TO service_role;
ALTER TABLE public.gm_gift_ad_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role manages gift ad tickets" ON public.gm_gift_ad_tickets FOR ALL TO service_role USING (true) WITH CHECK (true);
