import { createFileRoute } from '@tanstack/react-router';
import { json } from '@/lib/admin.server';
import { computeAccrued, getDb, resolveTelegramUser, upsertUser } from '@/lib/telegram-user.server';

export const Route = createFileRoute('/api/telegram/claim')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as { initData?: string };
        const initData = body.initData ?? request.headers.get('x-init-data');
        const user = resolveTelegramUser(initData);
        if (!user) return json({ error: 'Invalid or expired Telegram initData' }, 401);

        const row = await upsertUser(user);
        // The client-sent amount is never trusted — the server computes it.
        const { accrued } = await computeAccrued(user.id);
        // Keep 12 decimals: rounding to 6 made small accruals collapse to 0,
        // so the claim credited nothing and the balance never moved.
        const claimed = Math.round(Number(accrued) * 1_000_000_000_000) / 1_000_000_000_000;
        const db = await getDb();

        // Minimum claim amount — nothing under 0.001 can be claimed.
        const MIN_CLAIM = 0.001;

        if (!Number.isFinite(claimed) || claimed < MIN_CLAIM) {
          return json(
            {
              error: 'MIN_CLAIM',
              min: MIN_CLAIM,
              accrued: Number.isFinite(claimed) ? claimed : 0,
              balance: Number(row.balance ?? 0),
              claimed: 0,
            },
            400,
          );
        }

        // The database locks this user row, recalculates the capped amount, adds
        // it to the wallet, writes the new timestamp, and logs it atomically.
        // This prevents duplicate concurrent claims and partial updates.
        const { data: result, error } = await db.rpc('gm_claim_passive_mining', {
          _telegram_id: user.id,
          _minimum_claim: MIN_CLAIM,
        });
        if (error) {
          if (error.message.includes('MIN_CLAIM')) {
            return json({ error: 'MIN_CLAIM', min: MIN_CLAIM, accrued: claimed, balance: Number(row.balance ?? 0), claimed: 0 }, 400);
          }
          return json({ error: 'CLAIM_FAILED' }, 500);
        }
        const settled = result?.[0];
        const balance = Number(settled?.new_balance ?? row.balance ?? 0);
        const serverClaimed = Number(settled?.claimed_amount ?? claimed);
        return json({ balance, claimed: serverClaimed });
      },
    },
  },
});
