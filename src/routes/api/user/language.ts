import { createFileRoute } from '@tanstack/react-router';
import { json } from '@/lib/admin.server';
import { getDb, resolveTelegramUser } from '@/lib/telegram-user.server';

export const Route = createFileRoute('/api/user/language')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const initData =
          request.headers.get('x-init-data') ?? request.headers.get('x-telegram-initdata');
        const user = resolveTelegramUser(initData);
        if (!user) return json({ error: 'Invalid initData' }, 401);

        const db = await getDb();
        const { data } = await db
          .from('gm_users')
          .select('language')
          .eq('telegram_id', user.id)
          .maybeSingle();
        const language = (data as { language?: string | null } | null)?.language ?? null;
        const allowed = ['ar', 'en', 'ru'];
        return json({ language: language && allowed.includes(language) ? language : null });
      },
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as {
          initData?: string;
          language?: string;
        };
        const user = resolveTelegramUser(body.initData ?? request.headers.get('x-init-data'));
        if (!user) return json({ error: 'Invalid initData' }, 401);
        const language = ['ar', 'en', 'ru'].includes(String(body.language))
          ? String(body.language)
          : null;
        if (!language) return json({ error: 'Invalid language' }, 400);

        const db = await getDb();
        await db.from('gm_users').update({ language }).eq('telegram_id', user.id);
        return json({ ok: true, language });
      },
    },
  },
});