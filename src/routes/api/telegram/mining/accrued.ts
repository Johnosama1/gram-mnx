import { createFileRoute } from '@tanstack/react-router';
import { json } from '@/lib/admin.server';
import { computeAccrued, resolveTelegramUser, upsertUser } from '@/lib/telegram-user.server';

export const Route = createFileRoute('/api/telegram/mining/accrued')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const initData =
          request.headers.get('x-init-data') ?? request.headers.get('x-telegram-initdata');
        const user = resolveTelegramUser(initData);
        if (!user) return json({ error: 'Invalid initData' }, 401);
        await upsertUser(user);
        return json(await computeAccrued(user.id));
      },
    },
  },
});
