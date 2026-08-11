CREATE TABLE public.gm_gift_entries (
  id bigserial PRIMARY KEY,
  gift_id bigint NOT NULL,
  telegram_id bigint NOT NULL,
  chances integer NOT NULL DEFAULT 1,
  invited_count integer NOT NULL DEFAULT 0,
  referred_by bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gift_id, telegram_id)
);
GRANT ALL ON public.gm_gift_entries TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.gm_gift_entries_id_seq TO service_role;
ALTER TABLE public.gm_gift_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role manages gift entries" ON public.gm_gift_entries FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX gm_gift_entries_gift_idx ON public.gm_gift_entries (gift_id);