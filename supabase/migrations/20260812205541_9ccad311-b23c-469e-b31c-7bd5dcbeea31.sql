CREATE OR REPLACE FUNCTION public.gm_upsert_telegram_user(
  _telegram_id bigint,
  _username text,
  _first_name text,
  _last_name text
)
RETURNS SETOF public.gm_users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF _telegram_id IS NULL OR _telegram_id <= 0 THEN
    RAISE EXCEPTION 'INVALID_TELEGRAM_ID';
  END IF;

  INSERT INTO public.gm_users (
    telegram_id, username, first_name, last_name, last_active_at,
    last_mining_at, last_claim_at
  ) VALUES (
    _telegram_id, NULLIF(_username, ''), NULLIF(_first_name, ''), NULLIF(_last_name, ''), now(),
    now(), now()
  )
  ON CONFLICT (telegram_id) DO UPDATE SET
    username = EXCLUDED.username,
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    last_active_at = now();

  RETURN QUERY
  SELECT * FROM public.gm_users WHERE telegram_id = _telegram_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.gm_upsert_telegram_user(bigint,text,text,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gm_upsert_telegram_user(bigint,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.gm_submit_daily_combo(
  _telegram_id bigint,
  _combo_date text,
  _selected_ids integer[],
  _correct_ids integer[],
  _reward integer
)
RETURNS TABLE(success boolean, reward integer, already_attempted boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _selected_sorted integer[];
  _correct_sorted integer[];
  _success boolean;
  _gained integer;
BEGIN
  IF _telegram_id IS NULL OR _telegram_id <= 0 OR _combo_date IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  IF COALESCE(array_length(_selected_ids, 1), 0) <> 3
     OR COALESCE(array_length(_correct_ids, 1), 0) <> 3 THEN
    RAISE EXCEPTION 'SELECT_THREE';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(_selected_ids) x WHERE x < 1 OR x > 5)
     OR (SELECT count(DISTINCT x) FROM unnest(_selected_ids) x) <> 3 THEN
    RAISE EXCEPTION 'INVALID_SELECTION';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.gm_combo_attempts
    WHERE telegram_id = _telegram_id AND combo_date = _combo_date
  ) THEN
    RETURN QUERY SELECT false, 0, true;
    RETURN;
  END IF;

  SELECT array_agg(x ORDER BY x) INTO _selected_sorted FROM unnest(_selected_ids) x;
  SELECT array_agg(x ORDER BY x) INTO _correct_sorted FROM unnest(_correct_ids) x;
  _success := _selected_sorted = _correct_sorted;
  _gained := CASE WHEN _success THEN GREATEST(0, COALESCE(_reward, 0)) ELSE 0 END;

  BEGIN
    INSERT INTO public.gm_combo_attempts (telegram_id, combo_date, success, reward)
    VALUES (_telegram_id, _combo_date, _success, _gained);
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT false, 0, true;
    RETURN;
  END;

  IF _gained > 0 THEN
    PERFORM public.gm_add_coins(_telegram_id, _gained);
  END IF;

  RETURN QUERY SELECT _success, _gained, false;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.gm_submit_daily_combo(bigint,text,integer[],integer[],integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gm_submit_daily_combo(bigint,text,integer[],integer[],integer) TO service_role;

CREATE OR REPLACE FUNCTION public.gm_claim_daily_checkin(
  _telegram_id bigint,
  _rewards integer[]
)
RETURNS TABLE(ok boolean, coins_earned integer, streak_day integer, next_available_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _row public.gm_daily_checkins%ROWTYPE;
  _now timestamptz := now();
  _next integer;
  _reward integer;
BEGIN
  IF _telegram_id IS NULL OR _telegram_id <= 0 OR COALESCE(array_length(_rewards, 1), 0) = 0 THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  INSERT INTO public.gm_daily_checkins (telegram_id, streak_day, total_claims)
  VALUES (_telegram_id, 0, 0)
  ON CONFLICT (telegram_id) DO NOTHING;

  SELECT * INTO _row FROM public.gm_daily_checkins
  WHERE telegram_id = _telegram_id FOR UPDATE;

  IF _row.last_claim_at IS NOT NULL AND _row.last_claim_at > _now - interval '24 hours' THEN
    RETURN QUERY SELECT false, 0, _row.streak_day, _row.last_claim_at + interval '24 hours';
    RETURN;
  END IF;

  IF _row.last_claim_at IS NULL
     OR _row.last_claim_at <= _now - interval '48 hours'
     OR _row.streak_day >= array_length(_rewards, 1) THEN
    _next := 1;
  ELSE
    _next := _row.streak_day + 1;
  END IF;
  _reward := GREATEST(0, COALESCE(_rewards[_next], 0));

  UPDATE public.gm_daily_checkins SET
    streak_day = _next,
    last_claim_at = _now,
    total_claims = total_claims + 1,
    updated_at = _now
  WHERE telegram_id = _telegram_id;

  IF _reward > 0 THEN
    PERFORM public.gm_add_coins(_telegram_id, _reward);
  END IF;

  RETURN QUERY SELECT true, _reward, _next, _now + interval '24 hours';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.gm_claim_daily_checkin(bigint,integer[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gm_claim_daily_checkin(bigint,integer[]) TO service_role;