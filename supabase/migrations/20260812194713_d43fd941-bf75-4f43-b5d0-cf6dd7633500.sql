
CREATE OR REPLACE FUNCTION public.gm_set_mining_daily_pct(_pct double precision)
RETURNS double precision
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _now timestamptz := now();
  _p double precision := GREATEST(0.0, COALESCE(_pct, 5.0));
BEGIN
  -- Settle everyone's accrual at the OLD rate before switching.
  UPDATE public.gm_users
  SET unclaimed_mining_balance = round((
        GREATEST(0.0, COALESCE(unclaimed_mining_balance, 0.0))
        + GREATEST(0.0, COALESCE(mining_rate, 0.0))
          * GREATEST(0.0, EXTRACT(EPOCH FROM (_now - COALESCE(last_claim_at, created_at, _now))))
      )::numeric, 12)::double precision,
      last_claim_at = _now,
      last_mining_at = _now;

  INSERT INTO public.gm_settings (key, value)
  VALUES ('mining_daily_pct', _p::text)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

  UPDATE public.gm_users
  SET mining_rate = GREATEST(0.0, COALESCE(coins, 0.0)) / 700.0 * (_p / 100.0) / 86400.0;

  RETURN _p;
END;
$$;
