CREATE TABLE public.gm_users (
  id bigserial PRIMARY KEY,
  telegram_id bigint NOT NULL UNIQUE,
  username text,
  first_name text,
  last_name text,
  balance double precision NOT NULL DEFAULT 0,
  coins double precision NOT NULL DEFAULT 0,
  wallet_address text,
  is_banned boolean NOT NULL DEFAULT false,
  restrict_withdrawal boolean NOT NULL DEFAULT false,
  blocked_bot boolean NOT NULL DEFAULT false,
  language text,
  referred_by bigint,
  last_active_at timestamptz,
  last_mining_at timestamptz,
  mining_started_at timestamptz,
  miners_levels jsonb NOT NULL DEFAULT '{}'::jsonb,
  miners_last_claim_at bigint,
  twitter_handle text,
  twitter_linked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX gm_users_twitter_handle_key ON public.gm_users (lower(twitter_handle)) WHERE twitter_handle IS NOT NULL;

CREATE TABLE public.gm_settings (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE public.gm_tasks (
  id bigserial PRIMARY KEY,
  title text NOT NULL,
  description text DEFAULT '',
  reward double precision NOT NULL DEFAULT 0,
  is_daily boolean NOT NULL DEFAULT false,
  is_hidden boolean NOT NULL DEFAULT false,
  channel_username text,
  task_type text,
  join_link text,
  chat_id text,
  is_enabled boolean NOT NULL DEFAULT true,
  category text NOT NULL DEFAULT 'general',
  bot_username text,
  twitter_url text,
  slot_limit integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.gm_task_completions (
  id bigserial PRIMARY KEY,
  telegram_id bigint NOT NULL,
  task_id bigint NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (telegram_id, task_id)
);

CREATE TABLE public.gm_referrals (
  id bigserial PRIMARY KEY,
  referrer_id bigint NOT NULL,
  referred_id bigint NOT NULL UNIQUE,
  reward_paid boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.gm_referral_milestones (
  id bigserial PRIMARY KEY,
  invite_count integer NOT NULL,
  reward_coins integer NOT NULL DEFAULT 0,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.gm_referral_milestone_credits (
  id bigserial PRIMARY KEY,
  telegram_id bigint NOT NULL,
  milestone_id bigint NOT NULL,
  credited_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (telegram_id, milestone_id)
);

CREATE TABLE public.gm_channels (
  id bigserial PRIMARY KEY,
  channel_username text NOT NULL,
  channel_name text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.gm_withdrawals (
  id bigserial PRIMARY KEY,
  telegram_id bigint NOT NULL,
  wallet_address text NOT NULL,
  amount double precision NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  tx_hash text,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE TABLE public.gm_deposits (
  id bigserial PRIMARY KEY,
  telegram_id bigint NOT NULL,
  wallet_address text NOT NULL,
  tx_hash text NOT NULL UNIQUE,
  amount double precision NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  confirmations integer NOT NULL DEFAULT 0,
  credited_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  rejection_reason text
);

CREATE TABLE public.gm_swaps (
  id bigserial PRIMARY KEY,
  telegram_id bigint NOT NULL,
  direction text NOT NULL,
  gram_amount double precision NOT NULL,
  coins_amount integer NOT NULL,
  rate double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.gm_store_products (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  description text DEFAULT '',
  coin_price integer NOT NULL,
  gram_value double precision NOT NULL DEFAULT 0,
  daily_mining_pct double precision NOT NULL DEFAULT 0.05,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.gm_store_purchases (
  id bigserial PRIMARY KEY,
  telegram_id bigint NOT NULL,
  product_id bigint NOT NULL,
  coins_paid integer NOT NULL,
  gram_value double precision NOT NULL DEFAULT 0,
  daily_mining_pct double precision NOT NULL DEFAULT 0.05,
  principal_remaining double precision NOT NULL DEFAULT 0,
  last_claim_at timestamptz,
  purchased_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.gm_earnings_log (
  id bigserial PRIMARY KEY,
  telegram_id bigint NOT NULL,
  amount double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.gm_combo_attempts (
  id bigserial PRIMARY KEY,
  telegram_id bigint NOT NULL,
  combo_date text NOT NULL,
  success boolean NOT NULL,
  reward integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (telegram_id, combo_date)
);

CREATE TABLE public.gm_tournaments (
  id serial PRIMARY KEY,
  title text NOT NULL,
  top_n integer NOT NULL DEFAULT 10,
  prizes text NOT NULL DEFAULT '[]',
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active',
  snapshot text,
  settled_at timestamptz,
  tournament_type text NOT NULL DEFAULT 'gram',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.gm_task_submissions (
  id bigserial PRIMARY KEY,
  telegram_id bigint NOT NULL,
  task_id bigint NOT NULL,
  kind text NOT NULL,
  payload text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  reject_reason text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX gm_task_submissions_user_task_idx ON public.gm_task_submissions (telegram_id, task_id);
CREATE UNIQUE INDEX gm_task_submissions_bot_payload_idx ON public.gm_task_submissions (task_id, lower(payload)) WHERE kind = 'bot';

CREATE TABLE public.gm_ad_views (
  id bigserial PRIMARY KEY,
  telegram_id bigint NOT NULL,
  coins double precision NOT NULL DEFAULT 0.5,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.gm_daily_checkins (
  id bigserial PRIMARY KEY,
  telegram_id bigint NOT NULL UNIQUE,
  streak_day integer NOT NULL DEFAULT 0,
  last_claim_at timestamptz,
  total_claims integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.gm_user_ips (
  id bigserial PRIMARY KEY,
  telegram_id bigint NOT NULL,
  ip text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (telegram_id, ip)
);

CREATE TABLE public.gm_support_messages (
  id bigserial PRIMARY KEY,
  telegram_id bigint NOT NULL,
  username text,
  kind text NOT NULL DEFAULT 'complaint',
  message text NOT NULL,
  status text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX gm_task_completions_tg_idx ON public.gm_task_completions (telegram_id);
CREATE INDEX gm_referrals_referrer_idx ON public.gm_referrals (referrer_id);
CREATE INDEX gm_withdrawals_tg_idx ON public.gm_withdrawals (telegram_id);
CREATE INDEX gm_deposits_tg_idx ON public.gm_deposits (telegram_id);
CREATE INDEX gm_store_purchases_tg_idx ON public.gm_store_purchases (telegram_id);
CREATE INDEX gm_earnings_log_tg_created_idx ON public.gm_earnings_log (telegram_id, created_at);
CREATE INDEX gm_ad_views_user_time_idx ON public.gm_ad_views (telegram_id, created_at DESC);
CREATE INDEX gm_user_ips_ip_idx ON public.gm_user_ips (ip);
CREATE INDEX idx_gm_support_messages_created_at ON public.gm_support_messages (created_at DESC);

GRANT ALL ON public.gm_users TO service_role;
GRANT ALL ON public.gm_settings TO service_role;
GRANT ALL ON public.gm_tasks TO service_role;
GRANT ALL ON public.gm_task_completions TO service_role;
GRANT ALL ON public.gm_referrals TO service_role;
GRANT ALL ON public.gm_referral_milestones TO service_role;
GRANT ALL ON public.gm_referral_milestone_credits TO service_role;
GRANT ALL ON public.gm_channels TO service_role;
GRANT ALL ON public.gm_withdrawals TO service_role;
GRANT ALL ON public.gm_deposits TO service_role;
GRANT ALL ON public.gm_swaps TO service_role;
GRANT ALL ON public.gm_store_products TO service_role;
GRANT ALL ON public.gm_store_purchases TO service_role;
GRANT ALL ON public.gm_earnings_log TO service_role;
GRANT ALL ON public.gm_combo_attempts TO service_role;
GRANT ALL ON public.gm_tournaments TO service_role;
GRANT ALL ON public.gm_task_submissions TO service_role;
GRANT ALL ON public.gm_ad_views TO service_role;
GRANT ALL ON public.gm_daily_checkins TO service_role;
GRANT ALL ON public.gm_user_ips TO service_role;
GRANT ALL ON public.gm_support_messages TO service_role;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

ALTER TABLE public.gm_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gm_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gm_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gm_task_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gm_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gm_referral_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gm_referral_milestone_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gm_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gm_withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gm_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gm_swaps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gm_store_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gm_store_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gm_earnings_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gm_combo_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gm_tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gm_task_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gm_ad_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gm_daily_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gm_user_ips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gm_support_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role manages tournaments" ON public.gm_tournaments FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role manages task submissions" ON public.gm_task_submissions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role manages ad views" ON public.gm_ad_views FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role manages daily checkins" ON public.gm_daily_checkins FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role manages user ips" ON public.gm_user_ips FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role manages support messages" ON public.gm_support_messages FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_gm_task_submissions_updated_at
  BEFORE UPDATE ON public.gm_task_submissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_gm_daily_checkins_updated_at
  BEFORE UPDATE ON public.gm_daily_checkins
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.gm_referral_milestones (invite_count, reward_coins, is_enabled)
VALUES (1, 5, true), (10, 50, true), (25, 200, true), (50, 250, true), (100, 400, true), (200, 700, true), (1000, 2000, true);

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.schedule(
  'gm-ton-deposit-scan',
  '* * * * *',
  $$select net.http_post(
      url := 'https://project--8fa634e4-851e-472c-8625-6ea0f85447e6-dev.lovable.app/api/public/ton/deposit-scan',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb
    );$$
);