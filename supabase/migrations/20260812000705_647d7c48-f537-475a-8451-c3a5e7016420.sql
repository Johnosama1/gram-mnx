CREATE TABLE IF NOT EXISTS public.gm_gift_invites (
  invitee_id bigint PRIMARY KEY,
  referrer_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gm_gift_invites_referrer ON public.gm_gift_invites (referrer_id);
GRANT ALL ON public.gm_gift_invites TO service_role;
ALTER TABLE public.gm_gift_invites ENABLE ROW LEVEL SECURITY;