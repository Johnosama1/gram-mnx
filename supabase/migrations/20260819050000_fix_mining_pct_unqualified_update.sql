-- gm_set_mining_daily_pct intentionally updates every row in gm_users (it's
-- applying a new global mining percentage to all users), but Supabase's
-- Postgres runs with the safe-update guard enabled, which rejects any
-- UPDATE with no WHERE clause at all — even one that's intentionally
-- unqualified inside a SECURITY DEFINER function. That's what admins hit as
-- "UPDATE requires a WHERE clause" when saving the daily mining percentage.
-- `WHERE true` satisfies the guard without changing which rows are touched.
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
      last_mining_at = _now
  WHERE true;

  INSERT INTO public.gm_settings (key, value)
  VALUES ('mining_daily_pct', _p::text)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

  UPDATE public.gm_users
  SET mining_rate = GREATEST(0.0, COALESCE(coins, 0.0)) / 700.0 * (_p / 100.0) / 86400.0
  WHERE true;

  RETURN _p;
END;
$$;

-- Same fix for the (currently unused by the app, but latent) bulk recalc helper.
CREATE OR REPLACE FUNCTION public.gm_recalc_all_mining_rates()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.gm_users
  SET mining_rate = public.gm_mining_rate_for_coins(coins)
  WHERE true;
$$;

NOTIFY pgrst, 'reload schema';
