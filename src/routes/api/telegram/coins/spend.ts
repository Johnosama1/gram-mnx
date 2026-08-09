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
        const current = Number(row.coins ?? 0);
        if (current < amount) {
          return json({ error: 'Insufficient coin balance', coins: current }, 400);
        }

        const coins = current - amount;
        const db = await getDb();
        await db.from('gm_users').update({ coins }).eq('telegram_id', user.id);
        return json({ coins });
      },
    },
  },
});
