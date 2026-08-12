
INSERT INTO public.gm_settings (key, value)
VALUES ('mining_daily_pct', '5')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.gm_mining_daily_pct()
RETURNS double precision
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT GREATEST(0.0, COALESCE(
    (SELECT NULLIF(value, '')::double precision FROM public.gm_settings WHERE key = 'mining_daily_pct'),
    5.0
  ));
$$;

CREATE OR REPLACE FUNCTION public.gm_mining_rate_for_coins(_coins double precision)
RETURNS double precision
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT GREATEST(0.0, COALESCE(_coins, 0.0)) / 700.0 * (public.gm_mining_daily_pct() / 100.0) / 86400.0;
$$;

CREATE OR REPLACE FUNCTION public.gm_sync_mining_rate_on_coins_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _now timestamptz := now();
  _elapsed double precision;
  _settled double precision;
BEGIN
  IF NEW.coins IS NOT DISTINCT FROM OLD.coins THEN
    RETURN NEW;
  END IF;

  _elapsed := GREATEST(
    0.0,
    EXTRACT(EPOCH FROM (_now - COALESCE(OLD.last_claim_at, OLD.created_at, _now)))
  );
  _settled := round(
    (GREATEST(0.0, COALESCE(OLD.mining_rate, 0.0)) * _elapsed)::numeric,
    12
  )::double precision;

  NEW.unclaimed_mining_balance := round(
    (GREATEST(0.0, COALESCE(OLD.unclaimed_mining_balance, 0.0)) + _settled)::numeric,
    12
  )::double precision;
  NEW.last_claim_at := _now;
  NEW.last_mining_at := _now;
  NEW.mining_started_at := _now;
  NEW.mining_coins := GREATEST(0.0, COALESCE(NEW.coins, 0.0));
  NEW.mining_rate := public.gm_mining_rate_for_coins(NEW.coins);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.gm_claim_passive_mining(_telegram_id bigint, _minimum_claim double precision DEFAULT 0.001)
 RETURNS TABLE(new_balance double precision, claimed_amount double precision, new_last_claim_at timestamp with time zone, new_mining_rate double precision)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _user public.gm_users%ROWTYPE;
  _now timestamptz := now();
  _elapsed double precision;
  _claimed double precision;
  _balance double precision;
  _next_rate double precision;
BEGIN
  SELECT * INTO _user
  FROM public.gm_users
  WHERE telegram_id = _telegram_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;

  _elapsed := GREATEST(0.0, EXTRACT(EPOCH FROM (_now - _user.last_claim_at)));
  _claimed := round((
    GREATEST(0.0, COALESCE(_user.unclaimed_mining_balance, 0.0))
    + GREATEST(0.0, COALESCE(_user.mining_rate, 0.0)) * _elapsed
  )::numeric, 12)::double precision;

  IF _claimed IS NULL
    OR _claimed = 'NaN'::double precision
    OR abs(_claimed) = 'Infinity'::double precision
    OR _claimed < _minimum_claim THEN
    RAISE EXCEPTION 'MIN_CLAIM';
  END IF;

  _balance := round((COALESCE(_user.balance, 0.0) + _claimed)::numeric, 12)::double precision;
  _next_rate := public.gm_mining_rate_for_coins(_user.coins);

  UPDATE public.gm_users
  SET balance = _balance,
      unclaimed_mining_balance = 0,
      last_claim_at = _now,
      mining_rate = _next_rate,
      last_mining_at = _now,
      mining_started_at = _now,
      mining_coins = COALESCE(coins, 0.0),
      last_active_at = _now
  WHERE telegram_id = _telegram_id;

  INSERT INTO public.gm_earnings_log (telegram_id, amount)
  VALUES (_telegram_id, _claimed);

  RETURN QUERY SELECT _balance, _claimed, _now, _next_rate;
END;
$function$;

-- Recalculate all existing users' rate with the configurable percentage.
CREATE OR REPLACE FUNCTION public.gm_recalc_all_mining_rates()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.gm_users
  SET mining_rate = public.gm_mining_rate_for_coins(coins);
$$;

SELECT public.gm_recalc_all_mining_rates();
