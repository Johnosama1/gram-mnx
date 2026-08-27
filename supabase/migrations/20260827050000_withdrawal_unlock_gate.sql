-- Withdrawal-unlock gate: on activation, every existing user (deposited
-- before or not) is locked out of withdrawals. A NEW deposit confirmed
-- after this migration runs is what unlocks it — old deposits already
-- processed before this column existed never re-trigger the credit path,
-- so they can never retroactively count. An admin can also unlock/lock
-- any single user manually from the panel regardless of deposit history.
ALTER TABLE public.gm_users
  ADD COLUMN IF NOT EXISTS withdrawal_unlocked boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
