import { createFileRoute } from '@tanstack/react-router';
import { json } from '@/lib/admin.server';
import { getDb, resolveTelegramUser, upsertUser } from '@/lib/telegram-user.server';

export const Route = createFileRoute('/api/telegram/coins/spend')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as {
          initData?: string;
          amount?: number;
        };
        const user = resolveTelegramUser(body.initData ?? null);
        if (!user) return json({ error: 'Invalid or expired Telegram initData' }, 401);

        const amount = Number(body.amount);
        if (!Number.isInteger(amount) || amount <= 0) {
          return json({ error: 'Invalid amount — must be a positive integer' }, 400);
        }

        const row = await upsertUser(user);
        const db = (await getDb()) as any;
        // Atomic, row-locked spend: the balance check and the deduction happen
        // in one transaction, so concurrent requests cannot overspend.
        const { data: coins } = await db.rpc('gm_spend_coins', {
          _telegram_id: user.id,
          _amount: amount,
        });
        if (coins === null || coins === undefined) {
          return json({ error: 'Insufficient coin balance', coins: Number(row.coins ?? 0) }, 400);
        }
        return json({ coins: Number(coins) });
      },
    },
  },
});
