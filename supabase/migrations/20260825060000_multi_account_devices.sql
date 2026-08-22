-- Device-fingerprint dimension for the multi-account protection feature
-- (src/lib/multi-account.server.ts). Mirrors gm_user_ips exactly, but for a
-- client-persisted device id instead of an IP address — the two signals are
-- combined to decide whether a new account is the 4th+ tied to the same
-- person and should be auto-banned.
CREATE TABLE public.gm_user_devices (
  id bigserial PRIMARY KEY,
  telegram_id bigint NOT NULL,
  device_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (telegram_id, device_id)
);
CREATE INDEX gm_user_devices_device_idx ON public.gm_user_devices (device_id);

GRANT ALL ON public.gm_user_devices TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.gm_user_devices_id_seq TO service_role;

ALTER TABLE public.gm_user_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role manages user devices" ON public.gm_user_devices FOR ALL TO service_role USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
