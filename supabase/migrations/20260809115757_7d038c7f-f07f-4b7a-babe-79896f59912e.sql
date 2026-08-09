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
  mining_coins double precision,
  last_claim_at timestamptz NOT NULL DEFAULT now(),
  mining_rate double precision NOT NULL DEFAULT 0,
  unclaimed_mining_balance double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX gm_users_twitter_handle_key ON public.gm_users (lower(twitter_handle)) WHERE twitter_handle IS NOT NULL;
CREATE INDEX idx_gm_users_telegram_id ON public.gm_users (telegram_id);
CREATE INDEX idx_gm_users_referred_by ON public.gm_users (referred_by);

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
CREATE INDEX idx_gm_tasks_enabled ON public.gm_tasks (is_enabled, category);

CREATE TABLE public.gm_task_completions (
  id bigserial PRIMARY KEY,
  telegram_id bigint NOT NULL,
  task_id bigint NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (telegram_id, task_id)
);
CREATE INDEX gm_task_completions_tg_idx ON public.gm_task_completions (telegram_id);

CREATE TABLE public.gm_referrals (
  id bigserial PRIMARY KEY,
  referrer_id bigint NOT NULL,
  referred_id bigint NOT NULL UNIQUE,
  reward_paid boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gm_referrals_referrer_idx ON public.gm_referrals (referrer_id);

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
  channel_message_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX gm_withdrawals_tg_idx ON public.gm_withdrawals (telegram_id);
CREATE INDEX idx_gm_withdrawals_tg_created ON public.gm_withdrawals (telegram_id, created_at DESC);
CREATE INDEX idx_gm_withdrawals_status ON public.gm_withdrawals (status);

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
CREATE INDEX gm_deposits_tg_idx ON public.gm_deposits (telegram_id);
CREATE INDEX idx_gm_deposits_tg_created ON public.gm_deposits (telegram_id, created_at DESC);
CREATE INDEX idx_gm_deposits_status ON public.gm_deposits (status);

CREATE TABLE public.gm_swaps (
  id bigserial PRIMARY KEY,
  telegram_id bigint NOT NULL,
  direction text NOT NULL,
  gram_amount double precision NOT NULL,
  coins_amount integer NOT NULL,
  rate double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_gm_swaps_tg_created ON public.gm_swaps (telegram_id, created_at DESC);

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
CREATE INDEX gm_store_purchases_tg_idx ON public.gm_store_purchases (telegram_id);

CREATE TABLE public.gm_earnings_log (
  id bigserial PRIMARY KEY,
  telegram_id bigint NOT NULL,
  amount double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gm_earnings_log_tg_created_idx ON public.gm_earnings_log (telegram_id, created_at);

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
CREATE INDEX gm_ad_views_user_time_idx ON public.gm_ad_views (telegram_id, created_at DESC);

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
  country_code text,
  country_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (telegram_id, ip)
);
CREATE INDEX gm_user_ips_ip_idx ON public.gm_user_ips (ip);
CREATE INDEX gm_user_ips_country_idx ON public.gm_user_ips (country_code);

CREATE TABLE public.gm_support_messages (
  id bigserial PRIMARY KEY,
  telegram_id bigint NOT NULL,
  username text,
  kind text NOT NULL DEFAULT 'complaint',
  message text NOT NULL,
  status text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_gm_support_messages_created_at ON public.gm_support_messages (created_at DESC);

CREATE TABLE public.gm_promo_codes (
  id bigserial PRIMARY KEY,
  code text NOT NULL,
  reward_coins double precision NOT NULL DEFAULT 0,
  max_uses integer NOT NULL DEFAULT 0,
  current_uses integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX gm_promo_codes_code_key ON public.gm_promo_codes (upper(code));

CREATE TABLE public.gm_promo_redemptions (
  id bigserial PRIMARY KEY,
  telegram_id bigint NOT NULL,
  code_id bigint NOT NULL REFERENCES public.gm_promo_codes(id) ON DELETE CASCADE,
  reward_coins double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (telegram_id, code_id)
);

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
GRANT ALL ON public.gm_promo_codes TO service_role;
GRANT ALL ON public.gm_promo_redemptions TO service_role;
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
ALTER TABLE public.gm_promo_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gm_promo_redemptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role manages tournaments" ON public.gm_tournaments FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role manages task submissions" ON public.gm_task_submissions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role manages ad views" ON public.gm_ad_views FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role manages daily checkins" ON public.gm_daily_checkins FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role manages user ips" ON public.gm_user_ips FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role manages support messages" ON public.gm_support_messages FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role manages promo codes" ON public.gm_promo_codes FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role manages promo redemptions" ON public.gm_promo_redemptions FOR ALL TO service_role USING (true) WITH CHECK (true);

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

CREATE OR REPLACE FUNCTION public.gm_sync_mining_rate_on_coins_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _now timestamptz := now();
  _elapsed double precision;
  _settled double precision;
BEGIN
  IF NEW.coins IS NOT DISTINCT FROM OLD.coins THEN
    RETURN NEW;
  END IF;

  _elapsed := GREATEST(
    0.0,
    EXTRACT(EPOCH FROM (_now - COALESCE(OLD.last_claim_at, OLD.created_at, _now)))
  );
  _settled := round(
    (GREATEST(0.0, COALESCE(OLD.mining_rate, 0.0)) * _elapsed)::numeric,
    12
  )::double precision;

  NEW.unclaimed_mining_balance := round(
    (GREATEST(0.0, COALESCE(OLD.unclaimed_mining_balance, 0.0)) + _settled)::numeric,
    12
  )::double precision;
  NEW.last_claim_at := _now;
  NEW.last_mining_at := _now;
  NEW.mining_started_at := _now;
  NEW.mining_coins := GREATEST(0.0, COALESCE(NEW.coins, 0.0));
  NEW.mining_rate := GREATEST(0.0, COALESCE(NEW.coins, 0.0)) / 14000.0 / 86400.0;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS gm_sync_mining_rate_on_coins_change ON public.gm_users;
CREATE TRIGGER gm_sync_mining_rate_on_coins_change
BEFORE UPDATE OF coins ON public.gm_users
FOR EACH ROW
EXECUTE FUNCTION public.gm_sync_mining_rate_on_coins_change();

REVOKE ALL ON FUNCTION public.gm_sync_mining_rate_on_coins_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gm_sync_mining_rate_on_coins_change() TO service_role;

CREATE OR REPLACE FUNCTION public.gm_claim_passive_mining(
  _telegram_id bigint,
  _minimum_claim double precision DEFAULT 0.001
)
RETURNS TABLE(
  new_balance double precision,
  claimed_amount double precision,
  new_last_claim_at timestamp with time zone,
  new_mining_rate double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _user public.gm_users%ROWTYPE;
  _now timestamptz := now();
  _elapsed double precision;
  _claimed double precision;
  _balance double precision;
  _next_rate double precision;
BEGIN
  SELECT * INTO _user
  FROM public.gm_users
  WHERE telegram_id = _telegram_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;

  _elapsed := GREATEST(0.0, EXTRACT(EPOCH FROM (_now - _user.last_claim_at)));
  _claimed := round((
    GREATEST(0.0, COALESCE(_user.unclaimed_mining_balance, 0.0))
    + GREATEST(0.0, COALESCE(_user.mining_rate, 0.0)) * _elapsed
  )::numeric, 12)::double precision;

  IF _claimed IS NULL
    OR _claimed = 'NaN'::double precision
    OR abs(_claimed) = 'Infinity'::double precision
    OR _claimed < _minimum_claim THEN
    RAISE EXCEPTION 'MIN_CLAIM';
  END IF;

  _balance := round((COALESCE(_user.balance, 0.0) + _claimed)::numeric, 12)::double precision;
  _next_rate := GREATEST(0.0, COALESCE(_user.coins, 0.0)) / 14000.0 / 86400.0;

  UPDATE public.gm_users
  SET balance = _balance,
      unclaimed_mining_balance = 0,
      last_claim_at = _now,
      mining_rate = _next_rate,
      last_mining_at = _now,
      mining_started_at = _now,
      mining_coins = COALESCE(coins, 0.0),
      last_active_at = _now
  WHERE telegram_id = _telegram_id;

  INSERT INTO public.gm_earnings_log (telegram_id, amount)
  VALUES (_telegram_id, _claimed);

  RETURN QUERY SELECT _balance, _claimed, _now, _next_rate;
END;
$function$;

REVOKE ALL ON FUNCTION public.gm_claim_passive_mining(bigint, double precision) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gm_claim_passive_mining(bigint, double precision) TO service_role;