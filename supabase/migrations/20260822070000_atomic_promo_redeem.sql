-- Redeeming a promo code used to be a read-then-write sequence in app code:
-- select the code row, check it, insert the redemption, then update
-- current_uses from the value read earlier. Under many users redeeming the
-- same code at nearly the same time, that's a classic lost-update race
-- (current_uses under-counts, so max_uses can be exceeded) and it also holds
-- several separate round trips per request, which is what actually caused
-- the slowdown under a promo-code traffic spike. This folds the whole
-- check + redeem + payout into one row-locked, atomic operation.
CREATE OR REPLACE FUNCTION public.gm_redeem_promo_code(
  _telegram_id bigint,
  _code text
)
RETURNS TABLE(status text, reward_coins double precision, code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _row public.gm_promo_codes%ROWTYPE;
  _next_uses integer;
  _inserted boolean := true;
BEGIN
  -- Locks the code row so concurrent redeemers of the SAME code serialize
  -- here instead of racing on current_uses.
  SELECT * INTO _row FROM public.gm_promo_codes WHERE upper(gm_promo_codes.code) = upper(_code) FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::double precision, NULL::text;
    RETURN;
  END IF;

  -- Checked before is_active on purpose: once a code hits max_uses it gets
  -- auto-deactivated below, and a later request landing on that same
  -- already-inactive row must still be told "full", not "invalid" — those
  -- are different situations and the client shows a different message for
  -- each.
  IF _row.max_uses > 0 AND _row.current_uses >= _row.max_uses THEN
    RETURN QUERY SELECT 'full'::text, NULL::double precision, NULL::text;
    RETURN;
  END IF;

  IF _row.is_active = false THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::double precision, NULL::text;
    RETURN;
  END IF;

  -- The unique (telegram_id, code_id) index is still the source of truth
  -- for "already redeemed by this user" — same as before.
  BEGIN
    INSERT INTO public.gm_promo_redemptions (telegram_id, code_id, reward_coins)
    VALUES (_telegram_id, _row.id, _row.reward_coins);
  EXCEPTION WHEN unique_violation THEN
    _inserted := false;
  END;

  IF NOT _inserted THEN
    RETURN QUERY SELECT 'already_used'::text, NULL::double precision, NULL::text;
    RETURN;
  END IF;

  _next_uses := _row.current_uses + 1;
  UPDATE public.gm_promo_codes
  SET current_uses = _next_uses,
      is_active = CASE WHEN _row.max_uses > 0 AND _next_uses >= _row.max_uses THEN false ELSE _row.is_active END
  WHERE id = _row.id;

  -- Reuses the existing atomic coin-credit function — same rounding, same
  -- balance semantics as every other coin credit in the app.
  IF _row.reward_coins > 0 THEN
    PERFORM public.gm_add_coins(_telegram_id, _row.reward_coins);
  END IF;

  RETURN QUERY SELECT 'ok'::text, _row.reward_coins, _row.code;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.gm_redeem_promo_code(bigint, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gm_redeem_promo_code(bigint, text) TO service_role;

NOTIFY pgrst, 'reload schema';
