import { createFileRoute } from '@tanstack/react-router';
import { json } from '@/lib/admin.server';
import { getDb, resolveTelegramUser, upsertUser } from '@/lib/telegram-user.server';

export const Route = createFileRoute('/api/telegram/miners/save')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as {
          initData?: string;
          levels?: Record<string, unknown>;
          lastClaimAt?: number | null;
        };
        const initData = body.initData ?? request.headers.get('x-init-data') ?? null;
        const user = resolveTelegramUser(initData);
        if (!user) return json({ error: 'Invalid initData' }, 401);
        await upsertUser(user);

        // Sanitize levels: numeric keys → bounded integer levels
        const levels: Record<string, number> = {};
        for (const [k, v] of Object.entries(body.levels ?? {})) {
          const id = Number(k);
          const lvl = Math.floor(Number(v));
          if (Number.isFinite(id) && Number.isFinite(lvl) && lvl > 0 && lvl <= 1000) {
            levels[String(id)] = lvl;
          }
        }
        const lastClaimAt =
          typeof body.lastClaimAt === 'number' && Number.isFinite(body.lastClaimAt)
            ? Math.floor(body.lastClaimAt)
            : null;

        const db = await getDb();
        await db
          .from('gm_users')
          .update({ miners_levels: levels, miners_last_claim_at: lastClaimAt })
          .eq('telegram_id', user.id);

        return json({ ok: true });
      },
    },
  },
});