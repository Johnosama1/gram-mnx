CREATE TABLE public.gm_promo_codes (
  id bigserial PRIMARY KEY,
  code text NOT NULL,
  reward_coins double precision NOT NULL DEFAULT 0,
  max_uses integer NOT NULL DEFAULT 0,
  current_uses integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX gm_promo_codes_code_key ON public.gm_promo_codes (upper(code));

CREATE TABLE public.gm_promo_redemptions (
  id bigserial PRIMARY KEY,
  telegram_id bigint NOT NULL,
  code_id bigint NOT NULL REFERENCES public.gm_promo_codes(id) ON DELETE CASCADE,
  reward_coins double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (telegram_id, code_id)
);

GRANT ALL ON public.gm_promo_codes TO service_role;
GRANT ALL ON public.gm_promo_redemptions TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.gm_promo_codes_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.gm_promo_redemptions_id_seq TO service_role;

ALTER TABLE public.gm_promo_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gm_promo_redemptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role manages promo codes" ON public.gm_promo_codes FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role manages promo redemptions" ON public.gm_promo_redemptions FOR ALL TO service_role USING (true) WITH CHECK (true);