import { createFileRoute } from '@tanstack/react-router';
import { getAllAdminIds, getSetting, json } from '@/lib/admin.server';
import { resolveTelegramUser, upsertUser } from '@/lib/telegram-user.server';
import { touchIpFromRequest } from '@/lib/withdraw.server';
import { userSessionCookieHeader } from '@/lib/telegram-auth.server';
import { rateLimit, tooMany } from '@/lib/rate-limit.server';

export const Route = createFileRoute('/api/telegram/auth')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as { initData?: string };
        const initData =
          body.initData ??
          request.headers.get('x-init-data') ??
          request.headers.get('x-telegram-initdata');
        const user = resolveTelegramUser(initData);
        if (!user) return json({ error: 'Invalid or expired Telegram initData' }, 401);

        // Generous per-user cap: the client legitimately polls this endpoint
        // every 15-20s while the app is open (a few tabs included), so this
        // only ever trips on a scripted/abusive replay loop.
        if (!(await rateLimit(`auth:${user.id}`, 30, 60))) return tooMany();

        const { userExists } = await import('@/lib/telegram-user.server');
        const alreadyKnown = await userExists(user.id);

        const row = await upsertUser(user);
        await touchIpFromRequest(request, user.id);

        // Register the invite immediately when the WebApp is opened from a
        // referral link — but only for a brand-new user. Anyone who already
        // opened the bot before can never be counted as someone's referral.
        try {
          const startParam = new URLSearchParams(initData ?? '').get('start_param') ?? '';

          // Gift giveaway link (g_<id>) — counted for every user opening it,
          // even before they join a contest.
          const { parseGiftRef, recordGiftInvite } = await import('@/lib/gift.server');
          const giftRef = parseGiftRef(startParam);
          if (giftRef) {
            await recordGiftInvite(
              user.id,
              giftRef,
              user.username ? `@${user.username}` : (user.first_name ?? null),
            ).catch(() => false);
          }

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

        // This endpoint fires on every app open for every user, so the four
        // independent lookups below (none depends on another's result) are
        // batched into one round trip each instead of four sequential ones —
        // that's the difference between one and four DB round-trip latencies
        // stacked on every single request across a burst of concurrent users.
        const [adminIds, maintenanceMode, maintenanceMessageSetting, sendCurrenciesVisibleSetting] =
          await Promise.all([
            getAllAdminIds(),
            getSetting('maintenance_mode'),
            getSetting('maintenance_message'),
            getSetting('send_currencies_visible'),
          ]);
        const isAdmin = adminIds.includes(user.id);
        const response = json({
          user: {
            id: user.id,
            first_name: user.first_name,
            username: user.username,
            balance: Number(row.balance ?? 0),
            coins: Number(row.coins ?? 0),
          },
          isAdmin,
          // Maintenance is controlled from the admin panel; admins bypass it.
          maintenance: !isAdmin && maintenanceMode === 'true',
          maintenanceMessage:
            maintenanceMessageSetting || '🔧 The app is under maintenance, please try again later.',
          // "Sending currencies" on Profile can be hidden from regular users
          // from the admin panel; admins always see it regardless.
          sendCurrenciesVisible: isAdmin || sendCurrenciesVisibleSetting !== 'false',

          notJoinedChannels: [],
        });
        response.headers.append('set-cookie', userSessionCookieHeader(user));
        return response;
      },
    },
  },
});
