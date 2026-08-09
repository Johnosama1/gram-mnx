ALTER TABLE public.gm_users
  ADD COLUMN IF NOT EXISTS last_claim_at timestamptz,
  ADD COLUMN IF NOT EXISTS mining_rate double precision;

UPDATE public.gm_users
SET last_claim_at = COALESCE(last_claim_at, last_mining_at, mining_started_at, created_at, now()),
    mining_rate = COALESCE(
      mining_rate,
      GREATEST(0.0, COALESCE(mining_coins, coins, 0.0)) / 14000.0 / 86400.0
    )
WHERE last_claim_at IS NULL OR mining_rate IS NULL;

ALTER TABLE public.gm_users
  ALTER COLUMN last_claim_at SET DEFAULT now(),
  ALTER COLUMN last_claim_at SET NOT NULL,
  ALTER COLUMN mining_rate SET DEFAULT 0,
  ALTER COLUMN mining_rate SET NOT NULL;

DROP FUNCTION IF EXISTS public.gm_claim_passive_mining(bigint, double precision);

CREATE FUNCTION public.gm_claim_passive_mining(_telegram_id bigint, _minimum_claim double precision DEFAULT 0.001)
RETURNS TABLE(new_balance double precision, claimed_amount double precision, new_last_claim_at timestamptz, new_mining_rate double precision)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  _elapsed := LEAST(86400.0, GREATEST(0.0, EXTRACT(EPOCH FROM (_now - _user.last_claim_at))));
  _claimed := round((GREATEST(0.0, _user.mining_rate) * _elapsed)::numeric, 12)::double precision;

  IF _claimed IS NULL OR _claimed = 'NaN'::double precision OR abs(_claimed) = 'Infinity'::double precision OR _claimed < _minimum_claim THEN
    RAISE EXCEPTION 'MIN_CLAIM';
  END IF;

  _balance := round((COALESCE(_user.balance, 0.0) + _claimed)::numeric, 12)::double precision;
  _next_rate := GREATEST(0.0, COALESCE(_user.coins, 0.0)) / 14000.0 / 86400.0;

  UPDATE public.gm_users
  SET balance = _balance,
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
$$;

REVOKE ALL ON FUNCTION public.gm_claim_passive_mining(bigint, double precision) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gm_claim_passive_mining(bigint, double precision) TO service_role;