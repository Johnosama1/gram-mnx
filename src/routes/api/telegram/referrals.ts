import { createFileRoute } from '@tanstack/react-router';
import { json, notifyUser } from '@/lib/admin.server';
import { getDb, resolveTelegramUser, upsertUser } from '@/lib/telegram-user.server';
import {
  REFERRAL_REQUIRED_TASKS,
  creditReferralIfEligible,
  getDepositCommission,
  getFriendsProgress,
  getReferralPrice,
} from '@/lib/referral.server';

type MilestoneRow = { id: number; invite_count: number; reward_coins: number; is_enabled: boolean };

export const Route = createFileRoute('/api/telegram/referrals')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const initData =
          request.headers.get('x-init-data') ?? request.headers.get('x-telegram-initdata');
        const user = resolveTelegramUser(initData);
        if (!user) return json({ error: 'Invalid initData' }, 401);
        await upsertUser(user);

        const db = await getDb();

        const [referralPrice, refRes] = await Promise.all([
          getReferralPrice(),
          db.from('gm_referrals').select('id, referred_id, reward_paid').eq('referrer_id', user.id),
        ]);
        const referrals = ((refRes.data ?? []) as Array<{
          id: number;
          referred_id: number;
          reward_paid: boolean;
        }>).map((r) => ({ ...r, referred_id: Number(r.referred_id) }));

        const invitedIds = referrals.map((r) => r.referred_id);

        // One batched pass over every invited friend's conditions instead of a
        // per-friend round trip; then settle only the ones that actually qualify.
        const progressList = await getFriendsProgress(invitedIds);
        const progressById = new Map(progressList.map((p) => [p.id, p]));

        const toSettle = referrals.filter(
          (r) => !r.reward_paid && progressById.get(r.referred_id)?.eligible,
        );
        if (toSettle.length) {
          const settled = await Promise.all(
            toSettle.map((r) => creditReferralIfEligible(r.referred_id)),
          );
          toSettle.forEach((r, i) => {
            if (settled[i]) r.reward_paid = true;
          });
        }

        const fresh = referrals;
        const confirmedRows = fresh.filter((r) => r.reward_paid);
        const count = confirmedRows.length;
        const pending = fresh.length - count;

        // Milestones + credits
        const { data: msRows } = await db
          .from('gm_referral_milestones')
          .select('id, invite_count, reward_coins, is_enabled')
          .eq('is_enabled', true)
          .order('invite_count', { ascending: true });
        const msList = (msRows ?? []) as MilestoneRow[];

        const { data: creditRows } = await db
          .from('gm_referral_milestone_credits')
          .select('milestone_id')
          .eq('telegram_id', user.id);
        const credited = new Set(
          ((creditRows ?? []) as Array<{ milestone_id: number }>).map((c) => c.milestone_id),
        );

        // Credit newly reached milestones
        const newlyReached = msList.filter((m) => count >= m.invite_count && !credited.has(m.id));
        if (newlyReached.length > 0) {
          const bonus = newlyReached.reduce((s, m) => s + (Number(m.reward_coins) || 0), 0);
          // Claim the milestones FIRST: the unique (telegram_id, milestone_id)
          // index makes this the single source of truth, so two concurrent
          // requests can never both pay out the same milestone bonus.
          const { data: claimedRows } = await db
            .from('gm_referral_milestone_credits')
            .insert(newlyReached.map((m) => ({ telegram_id: user.id, milestone_id: m.id })))
            .select('milestone_id');
          const claimedIds = new Set(
            ((claimedRows ?? []) as Array<{ milestone_id: number }>).map((r) => Number(r.milestone_id)),
          );
          const paid = newlyReached.filter((m) => claimedIds.has(Number(m.id)));
          const payout = paid.reduce((s, m) => s + (Number(m.reward_coins) || 0), 0);
          if (payout > 0) {
            await db.rpc('gm_add_coins', { _telegram_id: user.id, _amount: payout });
          }
          if (bonus > 0) {
            await notifyUser(
              user.id,
              [
                '🏆 <b>Congrats! You reached a new referral milestone</b>',
                '',
                `🎯 ${newlyReached.map((m) => `${m.invite_count} referrals`).join(' + ')}`,
                `🎁 Reward: <b>${bonus} coin</b>`,
              ].join('\n'),
            );
          }
          newlyReached.forEach((m) => credited.add(m.id));
        }

        const milestones = msList.map((m) => ({
          id: m.id,
          inviteCount: m.invite_count,
          rewardCoins: m.reward_coins,
          isEnabled: m.is_enabled,
          reached: count >= m.invite_count,
          credited: credited.has(m.id),
        }));

        const next = milestones.find((m) => !m.reached);
        const progress = next ? Math.min(100, Math.round((count / next.inviteCount) * 100)) : 100;

        // Invited friends: names + usernames for the friends list UI
        const confirmedIds = new Set(confirmedRows.map((r) => Number(r.referred_id)));
        let friends: Array<{
          id: number;
          name: string;
          username: string | null;
          confirmed: boolean;
          wallet: boolean;
          combo: boolean;
          tasks: number;
        }> = [];
        if (invitedIds.length) {
          const { data: fRows } = await db
            .from('gm_users')
            .select('telegram_id, first_name, last_name, username')
            .in('telegram_id', invitedIds);
          const byId = new Map(
            ((fRows ?? []) as Array<Record<string, any>>).map((u) => [Number(u.telegram_id), u]),
          );
          friends = invitedIds.map((fid) => {
            const u = byId.get(fid);
            const name = [u?.first_name, u?.last_name].filter(Boolean).join(' ').trim();
            const p = progressById.get(fid);
            return {
              id: fid,
              name: name || (u?.username ? `@${u.username}` : `Miner ${String(fid).slice(-4)}`),
              username: u?.username ?? null,
              confirmed: confirmedIds.has(fid),
              wallet: Boolean(p?.wallet),
              combo: Boolean(p?.combo),
              tasks: Number(p?.tasks ?? 0),
            };
          });
        }

        // Coins earned = referral rewards + 10% commission on friends' deposits.
        const depositCommission = await getDepositCommission(invitedIds);

        // Aggregate condition stats across the invited friends (X out of N).
        const totalInvited = invitedIds.length;
        const walletCount = progressList.filter((p) => p.wallet).length;
        const comboCount = progressList.filter((p) => p.combo).length;
        const tasksCount = progressList.filter((p) => p.tasks >= REFERRAL_REQUIRED_TASKS).length;

        return json({
          count,
          confirmed: count,
          pending,
          reward: Number((count * referralPrice + depositCommission).toFixed(4)),
          referralReward: Number((count * referralPrice).toFixed(4)),
          depositCommission,
          referralPrice,
          requirements: {
            tasksRequired: REFERRAL_REQUIRED_TASKS,
            totalInvited,
            walletCount,
            comboCount,
            tasksCount,
          },
          milestones,
          progress,
          friends,
        });
      },
    },
  },
});