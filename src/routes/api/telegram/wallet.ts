import { createFileRoute } from '@tanstack/react-router';
import { json } from '@/lib/admin.server';
import { reqLang, tr } from '@/lib/i18n.server';
import { getDb, resolveTelegramUser, upsertUser } from '@/lib/telegram-user.server';

async function readBody(request: Request) {
  return (await request.json().catch(() => ({}))) as { initData?: string; address?: string };
}

function getInit(request: Request, body: { initData?: string }) {
  return (
    body.initData ??
    request.headers.get('x-init-data') ??
    request.headers.get('x-telegram-initdata')
  );
}

export const Route = createFileRoute('/api/telegram/wallet')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = resolveTelegramUser(
          request.headers.get('x-init-data') ?? request.headers.get('x-telegram-initdata'),
        );
        if (!user) return json({ message: 'Invalid initData' }, 401);
        const db = await getDb();
        const { data } = await db
          .from('gm_users')
          .select('wallet_address')
          .eq('telegram_id', user.id)
          .maybeSingle();
        return json({ address: (data as { wallet_address?: string } | null)?.wallet_address ?? null });
      },
      POST: async ({ request }) => {
        const body = await readBody(request);
        const user = resolveTelegramUser(getInit(request, body));
        if (!user) return json({ message: 'Invalid initData' }, 401);
        const address = String(body.address ?? '').trim();
        if (!address) return json({ message: 'address required' }, 400);
        // Hard server-side format guard: only TON address shapes are stored,
        // so nothing arbitrary can be injected into the payout pipeline.
        if (!/^(?:[A-Za-z0-9_-]{48}|-?\d+:[0-9a-fA-F]{64})$/.test(address))
          return json({ message: 'address required' }, 400);
        await upsertUser(user);
        const db = await getDb();

        const { data: taken } = await db
          .from('gm_users')
          .select('telegram_id')
          .eq('wallet_address', address)
          .neq('telegram_id', user.id)
          .maybeSingle();
        if (taken) return json({ message: tr(reqLang(request, body as any), 'wallet_taken') }, 409);

        await db.from('gm_users').update({ wallet_address: address }).eq('telegram_id', user.id);
        const { creditReferralIfEligible } = await import('@/lib/referral.server');
        await creditReferralIfEligible(user.id).catch(() => undefined);
        return json({ ok: true, address });
      },
      DELETE: async ({ request }) => {
        const body = await readBody(request);
        const user = resolveTelegramUser(getInit(request, body));
        if (!user) return json({ message: 'Invalid initData' }, 401);
        const db = await getDb();
        await db.from('gm_users').update({ wallet_address: null }).eq('telegram_id', user.id);
        return json({ ok: true });
      },
    },
  },
});
