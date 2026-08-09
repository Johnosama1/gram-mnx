CREATE OR REPLACE FUNCTION public.gm_claim_passive_mining(_telegram_id bigint, _minimum_claim double precision DEFAULT 0.001)
RETURNS TABLE(new_balance double precision, claimed_amount double precision)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user public.gm_users%ROWTYPE;
  _now timestamptz := now();
  _anchor timestamptz;
  _elapsed double precision;
  _rate_coins double precision;
  _claimed double precision;
  _balance double precision;
BEGIN
  SELECT * INTO _user
  FROM public.gm_users
  WHERE telegram_id = _telegram_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;

  _anchor := COALESCE(_user.last_mining_at, _user.created_at, _now);
  _elapsed := LEAST(86400.0, GREATEST(0.0, EXTRACT(EPOCH FROM (_now - _anchor))));
  _rate_coins := GREATEST(0.0, COALESCE(_user.mining_coins, _user.coins, 0.0));
  _claimed := round((((_rate_coins / 14000.0) / 86400.0) * _elapsed)::numeric, 12)::double precision;

  IF NOT isfinite(_claimed) OR _claimed < _minimum_claim THEN
    RAISE EXCEPTION 'MIN_CLAIM';
  END IF;

  _balance := round((COALESCE(_user.balance, 0.0) + _claimed)::numeric, 12)::double precision;

  UPDATE public.gm_users
  SET balance = _balance,
      last_mining_at = _now,
      mining_started_at = _now,
      mining_coins = COALESCE(coins, 0.0),
      last_active_at = _now
  WHERE telegram_id = _telegram_id;

  INSERT INTO public.gm_earnings_log (telegram_id, amount)
  VALUES (_telegram_id, _claimed);

  RETURN QUERY SELECT _balance, _claimed;
END;
$$;

REVOKE ALL ON FUNCTION public.gm_claim_passive_mining(bigint, double precision) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gm_claim_passive_mining(bigint, double precision) TO service_role;