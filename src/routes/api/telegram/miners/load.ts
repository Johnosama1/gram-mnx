import { createFileRoute } from '@tanstack/react-router';
import { json } from '@/lib/admin.server';
import { getDb, resolveTelegramUser, upsertUser } from '@/lib/telegram-user.server';

export const Route = createFileRoute('/api/telegram/miners/load')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as { initData?: string };
        const initData =
          body.initData ?? request.headers.get('x-init-data') ?? null;
        const user = resolveTelegramUser(initData);
        if (!user) return json({ error: 'Invalid initData' }, 401);
        await upsertUser(user);

        const db = await getDb();
        const { data } = await db
          .from('gm_users')
          .select('miners_levels, miners_last_claim_at')
          .eq('telegram_id', user.id)
          .maybeSingle();

        const row = (data ?? {}) as {
          miners_levels?: Record<string, number> | null;
          miners_last_claim_at?: number | null;
        };
        return json({
          levels: row.miners_levels ?? {},
          lastClaimAt: row.miners_last_claim_at ?? null,
        });
      },
    },
  },
});