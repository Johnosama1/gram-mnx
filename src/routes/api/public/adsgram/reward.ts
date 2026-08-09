import { createFileRoute } from '@tanstack/react-router';

const COINS_PER_AD = 0.5;

export const Route = createFileRoute('/api/public/adsgram/reward')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const secret = process.env.ADSGRAM_REWARD_SECRET;
        const key = url.searchParams.get('key');
        if (secret && key !== secret) {
          return new Response('Forbidden', { status: 403 });
        }

        const userid = url.searchParams.get('userid') ?? url.searchParams.get('userId');
        if (!userid || !/^\d{3,20}$/.test(userid)) {
          return new Response('Bad Request', { status: 400 });
        }

        const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
        const { data: user } = await supabaseAdmin
          .from('gm_users')
          .select('coins')
          .eq('telegram_id', Number(userid))
          .maybeSingle();
        if (!user) return new Response('Not Found', { status: 404 });

        const { error } = await supabaseAdmin
          .from('gm_users')
          .update({ coins: Number((user as any).coins ?? 0) + COINS_PER_AD })
          .eq('telegram_id', Number(userid));
        if (error) return new Response('Error', { status: 500 });

        return Response.json({ ok: true, added: COINS_PER_AD });
      },
    },
  },
});