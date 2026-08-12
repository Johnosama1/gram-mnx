-- 1) Deny-by-default: the app only ever talks to the DB with the service role.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t.tablename);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t.tablename);
  END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION public.gm_claim_passive_mining(bigint, double precision) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.gm_set_mining_daily_pct(double precision) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.gm_recalc_all_mining_rates() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.gm_mining_rate_for_coins(double precision) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.gm_mining_daily_pct() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gm_claim_passive_mining(bigint, double precision) TO service_role;
GRANT EXECUTE ON FUNCTION public.gm_set_mining_daily_pct(double precision) TO service_role;
GRANT EXECUTE ON FUNCTION public.gm_recalc_all_mining_rates() TO service_role;

-- 2) Atomic money primitives (row-locked, so concurrent requests cannot double-spend).
CREATE OR REPLACE FUNCTION public.gm_debit_balance(_telegram_id bigint, _amount double precision)
RETURNS double precision
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _bal double precision;
BEGIN
  IF _amount IS NULL OR _amount <= 0 OR _amount = 'NaN'::double precision THEN RETURN NULL; END IF;
  SELECT COALESCE(balance,0) INTO _bal FROM public.gm_users WHERE telegram_id=_telegram_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF _bal + 1e-12 < _amount THEN RETURN NULL; END IF;
  _bal := round((_bal - _amount)::numeric, 12)::double precision;
  UPDATE public.gm_users SET balance=_bal WHERE telegram_id=_telegram_id;
  RETURN _bal;
END $$;

CREATE OR REPLACE FUNCTION public.gm_add_balance(_telegram_id bigint, _amount double precision)
RETURNS double precision
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _bal double precision;
BEGIN
  IF _amount IS NULL OR _amount = 'NaN'::double precision THEN RETURN NULL; END IF;
  SELECT COALESCE(balance,0) INTO _bal FROM public.gm_users WHERE telegram_id=_telegram_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  _bal := round((_bal + _amount)::numeric, 12)::double precision;
  UPDATE public.gm_users SET balance=_bal WHERE telegram_id=_telegram_id;
  RETURN _bal;
END $$;

CREATE OR REPLACE FUNCTION public.gm_add_coins(_telegram_id bigint, _amount double precision)
RETURNS double precision
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _c double precision;
BEGIN
  IF _amount IS NULL OR _amount = 'NaN'::double precision THEN RETURN NULL; END IF;
  SELECT COALESCE(coins,0) INTO _c FROM public.gm_users WHERE telegram_id=_telegram_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  _c := round((_c + _amount)::numeric, 12)::double precision;
  UPDATE public.gm_users SET coins=_c WHERE telegram_id=_telegram_id;
  RETURN _c;
END $$;

CREATE OR REPLACE FUNCTION public.gm_spend_coins(_telegram_id bigint, _amount double precision)
RETURNS double precision
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _c double precision;
BEGIN
  IF _amount IS NULL OR _amount <= 0 OR _amount = 'NaN'::double precision THEN RETURN NULL; END IF;
  SELECT COALESCE(coins,0) INTO _c FROM public.gm_users WHERE telegram_id=_telegram_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF _c < _amount THEN RETURN NULL; END IF;
  _c := round((_c - _amount)::numeric, 12)::double precision;
  UPDATE public.gm_users SET coins=_c WHERE telegram_id=_telegram_id;
  RETURN _c;
END $$;

CREATE OR REPLACE FUNCTION public.gm_swap_gram_to_coins(_telegram_id bigint, _gram double precision, _coins double precision)
RETURNS TABLE(new_balance double precision, new_coins double precision)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _bal double precision; _c double precision;
BEGIN
  IF _gram IS NULL OR _gram <= 0 OR _coins IS NULL OR _coins <= 0 THEN RETURN; END IF;
  SELECT COALESCE(balance,0), COALESCE(coins,0) INTO _bal, _c
  FROM public.gm_users WHERE telegram_id=_telegram_id FOR UPDATE;
  IF NOT FOUND OR _bal + 1e-12 < _gram THEN RETURN; END IF;
  _bal := round((_bal - _gram)::numeric, 12)::double precision;
  _c := round((_c + _coins)::numeric, 12)::double precision;
  UPDATE public.gm_users SET balance=_bal, coins=_c WHERE telegram_id=_telegram_id;
  RETURN QUERY SELECT _bal, _c;
END $$;

REVOKE EXECUTE ON FUNCTION public.gm_debit_balance(bigint,double precision) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.gm_add_balance(bigint,double precision) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.gm_add_coins(bigint,double precision) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.gm_spend_coins(bigint,double precision) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.gm_swap_gram_to_coins(bigint,double precision,double precision) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gm_debit_balance(bigint,double precision) TO service_role;
GRANT EXECUTE ON FUNCTION public.gm_add_balance(bigint,double precision) TO service_role;
GRANT EXECUTE ON FUNCTION public.gm_add_coins(bigint,double precision) TO service_role;
GRANT EXECUTE ON FUNCTION public.gm_spend_coins(bigint,double precision) TO service_role;
GRANT EXECUTE ON FUNCTION public.gm_swap_gram_to_coins(bigint,double precision,double precision) TO service_role;

-- 3) Server-side rate limiting / single-flight lock storage.
CREATE TABLE IF NOT EXISTS public.gm_rate_limits (
  bucket text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  hits integer NOT NULL DEFAULT 0
);
REVOKE ALL ON public.gm_rate_limits FROM anon, authenticated;
GRANT ALL ON public.gm_rate_limits TO service_role;
ALTER TABLE public.gm_rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role manages rate limits" ON public.gm_rate_limits
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.gm_rate_limit_hit(_bucket text, _limit integer, _window_seconds integer)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _row public.gm_rate_limits%ROWTYPE; _now timestamptz := now();
BEGIN
  INSERT INTO public.gm_rate_limits(bucket, window_start, hits)
  VALUES (_bucket, _now, 0)
  ON CONFLICT (bucket) DO NOTHING;

  SELECT * INTO _row FROM public.gm_rate_limits WHERE bucket=_bucket FOR UPDATE;

  IF _row.window_start < _now - make_interval(secs => _window_seconds) THEN
    UPDATE public.gm_rate_limits SET window_start=_now, hits=1 WHERE bucket=_bucket;
    RETURN true;
  END IF;

  IF _row.hits >= _limit THEN
    RETURN false;
  END IF;

  UPDATE public.gm_rate_limits SET hits=_row.hits+1 WHERE bucket=_bucket;
  RETURN true;
END $$;

REVOKE EXECUTE ON FUNCTION public.gm_rate_limit_hit(text,integer,integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gm_rate_limit_hit(text,integer,integer) TO service_role;