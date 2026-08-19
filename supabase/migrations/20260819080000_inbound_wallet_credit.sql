-- Inbound MNX credits from the separate "gram" bot. Each accepted request is
-- logged here with a UNIQUE transaction_id, which is what makes a resend of
-- the same transaction_id a no-op instead of a double credit.
CREATE TABLE public.gm_inbound_transfers (
  id bigserial PRIMARY KEY,
  transaction_id text NOT NULL UNIQUE,
  source text NOT NULL,
  telegram_id bigint NOT NULL,
  amount double precision NOT NULL,
  currency text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gm_inbound_transfers_telegram_id_idx ON public.gm_inbound_transfers (telegram_id);
GRANT ALL ON public.gm_inbound_transfers TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.gm_inbound_transfers_id_seq TO service_role;
ALTER TABLE public.gm_inbound_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role manages inbound transfers"
  ON public.gm_inbound_transfers FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Atomically reserves the transaction_id (rejecting a duplicate) and credits
-- the user's coins (MNX) balance in the same transaction. If the user row
-- doesn't exist, the whole thing rolls back — including the reservation —
-- so the transaction_id stays free for a retry once the user is valid.
CREATE OR REPLACE FUNCTION public.gm_credit_inbound_mnx(
  _transaction_id text,
  _telegram_id bigint,
  _amount double precision,
  _source text
)
RETURNS TABLE(duplicate boolean, new_balance double precision)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _c double precision;
  _inserted boolean := true;
BEGIN
  BEGIN
    INSERT INTO public.gm_inbound_transfers (transaction_id, source, telegram_id, amount, currency, status)
    VALUES (_transaction_id, _source, _telegram_id, _amount, 'MNX', 'credited');
  EXCEPTION WHEN unique_violation THEN
    _inserted := false;
  END;

  IF NOT _inserted THEN
    RETURN QUERY SELECT true, NULL::double precision;
    RETURN;
  END IF;

  SELECT COALESCE(coins, 0) INTO _c FROM public.gm_users WHERE telegram_id = _telegram_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_not_found';
  END IF;

  _c := round((_c + _amount)::numeric, 12)::double precision;
  UPDATE public.gm_users SET coins = _c WHERE telegram_id = _telegram_id;

  RETURN QUERY SELECT false, _c;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.gm_credit_inbound_mnx(text, bigint, double precision, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gm_credit_inbound_mnx(text, bigint, double precision, text) TO service_role;

NOTIFY pgrst, 'reload schema';
