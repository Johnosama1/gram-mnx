import { createFileRoute } from '@tanstack/react-router';
import { getAllAdminIds, getSetting, json } from '@/lib/admin.server';
import { resolveTelegramUser, upsertUser } from '@/lib/telegram-user.server';
import { touchIpFromRequest } from '@/lib/withdraw.server';

export const Route = createFileRoute('/api/telegram/auth')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as { initData?: string };
        const user = resolveTelegramUser(body.initData ?? null);
        if (!user) return json({ error: 'Invalid or expired Telegram initData' }, 401);

        const { userExists } = await import('@/lib/telegram-user.server');
        const alreadyKnown = await userExists(user.id);

        const row = await upsertUser(user);
        await touchIpFromRequest(request, user.id);

        // Register the invite immediately when the WebApp is opened from a
        // referral link — but only for a brand-new user. Anyone who already
        // opened the bot before can never be counted as someone's referral.
        try {
          const startParam = new URLSearchParams(body.initData ?? '').get('start_param') ?? '';
          const referrerId = Number(startParam.replace(/^ref_?/i, ''));
          if (Number.isFinite(referrerId) && referrerId > 0 && referrerId !== user.id) {
            const { registerReferral, creditReferralIfEligible } = await import(
              '@/lib/referral.server'
            );
            const created = await registerReferral(user.id, referrerId, {
              isNewUser: !alreadyKnown,
            });
            if (created) {
              const { notifyUser } = await import('@/lib/admin.server');
              const { getDb } = await import('@/lib/telegram-user.server');
              const db = await getDb();
              const [{ count: confirmed }, { count: pending }] = await Promise.all([
                db
                  .from('gm_referrals')
                  .select('id', { count: 'exact', head: true })
                  .eq('referrer_id', referrerId)
                  .eq('reward_paid', true),
                db
                  .from('gm_referrals')
                  .select('id', { count: 'exact', head: true })
                  .eq('referrer_id', referrerId)
                  .eq('reward_paid', false),
              ]);
              await notifyUser(
                referrerId,
                [
                  `<tg-emoji emoji-id="5258513401784573443">👥</tg-emoji> ${user.first_name ?? 'A new friend'} joined with your link`,
                  '',
                  `<tg-emoji emoji-id="5231200819986047254">📊</tg-emoji> Confirmed referrals: ${confirmed ?? 0}`,
                  `<tg-emoji emoji-id="5451732530048802485">⏳</tg-emoji> Pending referrals: ${pending ?? 0}`,
                ].join('\n'),
              ).catch(() => undefined);
            }
            await creditReferralIfEligible(user.id);
          }

        } catch (err) {
          console.error('referral from initData failed:', err);
        }

        const isAdmin = (await getAllAdminIds()).includes(user.id);
        return json({
          user: {
            id: user.id,
            first_name: user.first_name,
            username: user.username,
            balance: Number(row.balance ?? 0),
            coins: Number(row.coins ?? 0),
          },
          isAdmin,
          // Maintenance is controlled from the admin panel; admins bypass it.
          maintenance: !isAdmin && (await getSetting('maintenance_mode')) === 'true',
          maintenanceMessage:
            (await getSetting('maintenance_message')) ||
            '🔧 The app is under maintenance, please try again later.',

          notJoinedChannels: [],
        });
      },
    },
  },
});
