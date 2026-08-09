ALTER TABLE public.gm_user_ips
  ADD COLUMN IF NOT EXISTS country_code text,
  ADD COLUMN IF NOT EXISTS country_name text;

CREATE INDEX IF NOT EXISTS gm_user_ips_country_idx ON public.gm_user_ips (country_code);