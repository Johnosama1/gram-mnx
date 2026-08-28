CREATE TABLE public.gm_balance_deductions (
  id bigserial PRIMARY KEY,
  telegram_id bigint NOT NULL,
  amount double precision NOT NULL,
  admin_id bigint NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gm_balance_deductions_tg_idx ON public.gm_balance_deductions (telegram_id, created_at DESC);

GRANT ALL ON public.gm_balance_deductions TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.gm_balance_deductions_id_seq TO service_role;

ALTER TABLE public.gm_balance_deductions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role manages balance deductions" ON public.gm_balance_deductions FOR ALL TO service_role USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';