import { createFileRoute } from '@tanstack/react-router';
import { json } from '@/lib/admin.server';
import { computeAccrued, resolveTelegramUser, upsertUser } from '@/lib/telegram-user.server';

/**
 * Legacy endpoint. Mining is now permanently continuous (24/7), so there is no
 * session to start and nothing here may reset the accrual anchor — doing so
 * would wipe earnings gathered while the app was closed. It only reports the
 * current server-computed accrual.
 */
export const Route = createFileRoute('/api/telegram/mining/start')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as { initData?: string };
        const initData = body.initData ?? request.headers.get('x-init-data');
        const user = resolveTelegramUser(initData);
        if (!user) return json({ error: 'Invalid or expired Telegram initData' }, 401);

        await upsertUser(user);
        return json({ ...(await computeAccrued(user.id)), started: false });
      },
    },
  },
});
