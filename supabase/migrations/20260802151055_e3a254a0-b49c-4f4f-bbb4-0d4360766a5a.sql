SELECT cron.unschedule('gm-ton-deposit-scan');
SELECT cron.schedule(
  'gm-ton-deposit-scan',
  '* * * * *',
  $$
    SELECT net.http_post(
      url := 'https://gramminer.lovable.app/api/public/ton/deposit-scan',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb
    );
  $$
);
