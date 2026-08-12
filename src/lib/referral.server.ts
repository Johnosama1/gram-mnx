import { getSetting, notifyUser } from '@/lib/admin.server';
import { getDb } from '@/lib/telegram-user.server';
import { getGramToCoins } from '@/lib/swap.server';

/** A referral only counts once the invited user did all of these. */
export const REFERRAL_REQUIRED_TASKS = 3;

export type ReferralEligibility = {
  wallet: boolean;
  combo: boolean;
  checkin: boolean;
  tasks: number;
  eligible: boolean;
};


/**
 * Records an invite ONLY for a brand-new user (first ever contact with the bot).
 * If the person already opened the bot before — via the bot username or an
 * earlier link — no referral is ever recorded for them again.
 * Returns true when a new referral row was created.
 */
export async function registerReferral(
  referredId: number,
  referrerId: number,
  opts: { isNewUser?: boolean } = {},
): Promise<boolean> {
  if (!Number.isFinite(referrerId) || referrerId <= 0 || referrerId === referredId) return false;
  if (opts.isNewUser === false) return false;
  const db = (await getDb()) as any;

  // Never attach a referral to someone who already knew the bot.
  const { data: userRow } = await db
    .from('gm_users')
    .select('created_at, referred_by')
    .eq('telegram_id', referredId)
    .maybeSingle();
  if (userRow?.referred_by) return false;
  if (userRow?.created_at) {
    const ageMs = Date.now() - new Date(userRow.created_at).getTime();
    // The row is created moments before this call on first contact; anything
    // older means the user had already used the bot.
    if (ageMs > 5 * 60 * 1000) return false;
  }

  const { data: existing } = await db
    .from('gm_referrals')
    .select('id')
    .eq('referred_id', referredId)
    .maybeSingle();
  if (existing) return false;
  const { error } = await db
    .from('gm_referrals')
    .insert({ referrer_id: referrerId, referred_id: referredId, reward_paid: false });
  if (error) return false;
  await db.from('gm_users').update({ referred_by: referrerId }).eq('telegram_id', referredId);
  return true;
}

export async function getReferralPrice(): Promise<number> {
  const raw =
    (await getSetting('referral_reward')) ?? (await getSetting('referral_price')) ?? '1';
  return Number(raw) || 1;
}

/** Wallet linked + one solved combo + daily check-in + at least 3 completed tasks. */
export async function checkEligibility(telegramId: number): Promise<ReferralEligibility> {
  const db = (await getDb()) as any;

  const { data: user } = await db
    .from('gm_users')
    .select('wallet_address')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  const wallet = Boolean(user?.wallet_address);

  const { count: comboCount } = await db
    .from('gm_combo_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('telegram_id', telegramId)
    .eq('success', true);

  const { count: taskCount } = await db
    .from('gm_task_completions')
    .select('id', { count: 'exact', head: true })
    .eq('telegram_id', telegramId);

  const { data: checkinRow } = await db
    .from('gm_daily_checkins')
    .select('total_claims')
    .eq('telegram_id', telegramId)
    .maybeSingle();

  // A confirmed deposit alone qualifies the referral, regardless of the other steps.
  const { count: depositCount } = await db
    .from('gm_deposits')
    .select('id', { count: 'exact', head: true })
    .eq('telegram_id', telegramId)
    .in('status', ['credited', 'confirmed', 'completed']);
  const deposited = Number(depositCount ?? 0) > 0;

  const combo = Number(comboCount ?? 0) > 0;
  const checkin = Number(checkinRow?.total_claims ?? 0) > 0;
  const tasks = Number(taskCount ?? 0);
  return {
    wallet,
    combo,
    checkin,
    tasks,
    eligible: deposited || (wallet && combo && checkin && tasks >= REFERRAL_REQUIRED_TASKS),
  };
}


/**
 * Credits the inviter as soon as the invited user meets every condition.
 * Safe to call from any flow (task, combo, wallet); it does nothing when the
 * invite was already paid or the conditions are not met yet.
 */
export async function creditReferralIfEligible(referredId: number): Promise<boolean> {
  try {
    const db = (await getDb()) as any;
    const { data: row } = await db
      .from('gm_referrals')
      .select('id, referrer_id, reward_paid')
      .eq('referred_id', referredId)
      .maybeSingle();
    if (!row || row.reward_paid) return false;

    const status = await checkEligibility(referredId);
    if (!status.eligible) return false;

    const price = await getReferralPrice();
    const referrerId = Number(row.referrer_id);

    const { data: claimed } = await db
      .from('gm_referrals')
      .update({ reward_paid: true })
      .eq('id', row.id)
      .eq('reward_paid', false)
      .select('id')
      .maybeSingle();
    if (!claimed?.id) return false;

    await db.rpc('gm_add_coins', { _telegram_id: referrerId, _amount: price });

    const { count } = await db
      .from('gm_referrals')
      .select('id', { count: 'exact', head: true })
      .eq('referrer_id', referrerId)
      .eq('reward_paid', true);

    await notifyUser(
      referrerId,
      [
        '<tg-emoji emoji-id="5258513401784573443">👥</tg-emoji> New referral confirmed',
        '',
        `<tg-emoji emoji-id="5461151367559141950">🎉</tg-emoji> Reward: ${price} coin`,
        `<tg-emoji emoji-id="5231200819986047254">📊</tg-emoji> Total referrals: ${count ?? 0}`,
      ].join('\n'),
    ).catch(() => undefined);
    return true;
  } catch (err) {
    console.error('creditReferralIfEligible failed:', err);
    return false;
  }
}

/** Total coins earned from the 10% commission on invited users' deposits. */
export async function getDepositCommission(invitedIds: number[]): Promise<number> {
  if (!invitedIds.length) return 0;
  const db = (await getDb()) as any;
  const rate = await getGramToCoins();
  const { data } = await db
    .from('gm_deposits')
    .select('amount')
    .eq('status', 'confirmed')
    .in('telegram_id', invitedIds);
  let total = 0;
  for (const d of (data ?? []) as Array<{ amount: number }>) {
    total += Math.floor(Number(d.amount ?? 0) * rate) * 0.1;
  }
  return Number(total.toFixed(4));
}

export type FriendProgress = {
  id: number;
  wallet: boolean;
  combo: boolean;
  checkin: boolean;
  tasks: number;
  eligible: boolean;
};

/** Per-friend condition status for every invited user, in one batch of queries. */
export async function getFriendsProgress(invitedIds: number[]): Promise<FriendProgress[]> {
  if (!invitedIds.length) return [];
  const db = (await getDb()) as any;

  const [{ data: users }, { data: combos }, { data: tasks }, { data: checkins }, { data: deposits }] =
    await Promise.all([
      db.from('gm_users').select('telegram_id, wallet_address').in('telegram_id', invitedIds),
      db
        .from('gm_combo_attempts')
        .select('telegram_id')
        .eq('success', true)
        .in('telegram_id', invitedIds),
      db.from('gm_task_completions').select('telegram_id').in('telegram_id', invitedIds),
      db
        .from('gm_daily_checkins')
        .select('telegram_id, total_claims')
        .in('telegram_id', invitedIds),
      db
        .from('gm_deposits')
        .select('telegram_id')
        .in('status', ['credited', 'confirmed', 'completed'])
        .in('telegram_id', invitedIds),
    ]);

  const depositSet = new Set(
    ((deposits ?? []) as Array<{ telegram_id: number }>).map((d) => Number(d.telegram_id)),
  );

  const walletSet = new Set(
    ((users ?? []) as Array<{ telegram_id: number; wallet_address: string | null }>)
      .filter((u) => Boolean(u.wallet_address))
      .map((u) => Number(u.telegram_id)),
  );
  const comboSet = new Set(
    ((combos ?? []) as Array<{ telegram_id: number }>).map((c) => Number(c.telegram_id)),
  );
  const checkinSet = new Set(
    ((checkins ?? []) as Array<{ telegram_id: number; total_claims: number }>)
      .filter((c) => Number(c.total_claims ?? 0) > 0)
      .map((c) => Number(c.telegram_id)),
  );
  const taskCounts = new Map<number, number>();
  for (const row of (tasks ?? []) as Array<{ telegram_id: number }>) {
    const id = Number(row.telegram_id);
    taskCounts.set(id, (taskCounts.get(id) ?? 0) + 1);
  }

  return invitedIds.map((id) => {
    const wallet = walletSet.has(id);
    const combo = comboSet.has(id);
    const checkin = checkinSet.has(id);
    const t = taskCounts.get(id) ?? 0;
    return {
      id,
      wallet,
      combo,
      checkin,
      tasks: t,
      eligible:
        depositSet.has(id) || (wallet && combo && checkin && t >= REFERRAL_REQUIRED_TASKS),
    };
  });
}

