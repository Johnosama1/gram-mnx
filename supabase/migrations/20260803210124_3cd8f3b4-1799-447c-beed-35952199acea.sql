CREATE OR REPLACE FUNCTION public.gm_sync_mining_rate_on_coins_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _now timestamptz := now();
  _elapsed double precision;
  _settled double precision;
BEGIN
  IF NEW.coins IS NOT DISTINCT FROM OLD.coins THEN
    RETURN NEW;
  END IF;

  _elapsed := LEAST(86400.0, GREATEST(0.0, EXTRACT(EPOCH FROM (_now - COALESCE(OLD.last_claim_at, OLD.created_at, _now)))));
  _settled := round((GREATEST(0.0, COALESCE(OLD.mining_rate, 0.0)) * _elapsed)::numeric, 12)::double precision;

  NEW.balance := round((COALESCE(NEW.balance, 0.0) + _settled)::numeric, 12)::double precision;
  NEW.last_claim_at := _now;
  NEW.last_mining_at := _now;
  NEW.mining_started_at := _now;
  NEW.mining_coins := GREATEST(0.0, COALESCE(NEW.coins, 0.0));
  NEW.mining_rate := GREATEST(0.0, COALESCE(NEW.coins, 0.0)) / 14000.0 / 86400.0;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS gm_sync_mining_rate_on_coins_change ON public.gm_users;
CREATE TRIGGER gm_sync_mining_rate_on_coins_change
BEFORE UPDATE OF coins ON public.gm_users
FOR EACH ROW
EXECUTE FUNCTION public.gm_sync_mining_rate_on_coins_change();

REVOKE ALL ON FUNCTION public.gm_sync_mining_rate_on_coins_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gm_sync_mining_rate_on_coins_change() TO service_role;