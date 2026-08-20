-- Outbound MNX -> "gram" bot's Coin transfers, initiated from GRAM MNX's own
-- "Sending currencies" screen. Logged for idempotency/audit, mirroring
-- gm_inbound_transfers on the receiving side.
CREATE TABLE public.gm_outbound_transfers (
  id bigserial PRIMARY KEY,
  transaction_id text NOT NULL UNIQUE,
  telegram_id bigint NOT NULL,
  recipient_id text NOT NULL,
  amount double precision NOT NULL,
  status text NOT NULL, -- 'pending' | 'sent' | 'refunded'
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gm_outbound_transfers_telegram_id_idx ON public.gm_outbound_transfers (telegram_id, created_at DESC);
GRANT ALL ON public.gm_outbound_transfers TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.gm_outbound_transfers_id_seq TO service_role;
ALTER TABLE public.gm_outbound_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role manages outbound transfers"
  ON public.gm_outbound_transfers FOR ALL TO service_role USING (true) WITH CHECK (true);
