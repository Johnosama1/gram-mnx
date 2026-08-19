CREATE TABLE IF NOT EXISTS public.gm_gift_ad_views (
  id bigserial PRIMARY KEY,
  telegram_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.gm_gift_ad_views TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.gm_gift_ad_views_id_seq TO service_role;

ALTER TABLE public.gm_gift_ad_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role manages gift ad views"
  ON public.gm_gift_ad_views FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS gm_gift_ad_views_telegram_id_idx
  ON public.gm_gift_ad_views (telegram_id);

NOTIFY pgrst, 'reload schema';