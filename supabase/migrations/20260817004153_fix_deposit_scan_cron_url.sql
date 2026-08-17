-- The previous migration pointed this cron job at the wrong app domain
-- (gramminer.lovable.app), so the every-minute automatic deposit/withdrawal
-- scan was silently never reaching this project — deposits only ever got
-- credited when a user was actively on the deposit screen (which triggers
-- the same scan in-process). Point it at the real deployed domain.
SELECT cron.unschedule('gm-ton-deposit-scan');
SELECT cron.schedule(
  'gm-ton-deposit-scan',
  '* * * * *',
  $$
    SELECT net.http_post(
      url := 'https://gram-mnx.lovable.app/api/public/ton/deposit-scan',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb
    );
  $$
);
