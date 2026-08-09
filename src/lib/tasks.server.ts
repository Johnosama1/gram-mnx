import { json, getSetting, getBotToken } from '@/lib/admin.server';
import { getDb, resolveTelegramUser, upsertUser } from '@/lib/telegram-user.server';

const DAILY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CHECKIN_REWARDS = [2, 3, 4, 5, 6, 7, 10];

async function getCheckinRewards(): Promise<number[]> {
  const raw = await getSetting('daily_checkin_rewards');
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) return arr.map((n: unknown) => Number(n) || 0);
    } catch {
      /* fall back to defaults */
    }
  }
  return DEFAULT_CHECKIN_REWARDS;
}

/** Computes the current check-in state for a user. */
async function getCheckinState(telegramId: number) {
  const db = (await getDb()) as any;
  const rewards = await getCheckinRewards();
  const { data: row } = await db
    .from('gm_daily_checkins')
    .select('*')
    .eq('telegram_id', telegramId)
    .maybeSingle();

  const last = row?.last_claim_at ? new Date(row.last_claim_at).getTime() : null;
  const elapsed = last ? Date.now() - last : Infinity;
  let streak = Number(row?.streak_day ?? 0);

  // Missed more than a full extra day, or finished the cycle → restart at day 1.
  if (!last || elapsed >= 2 * DAILY_MS || streak >= rewards.length) streak = 0;

  const nextDay = streak + 1;
  const canClaim = !last || elapsed >= DAILY_MS;

  return {
    rewards,
    streakDay: Number(row?.streak_day ?? 0),
    nextDay,
    reward: rewards[nextDay - 1] ?? 0,
    canClaim,
    nextAvailableAt: last && !canClaim ? new Date(last + DAILY_MS).toISOString() : null,
    lastClaimAt: row?.last_claim_at ?? null,
  };
}

export type TaskCategory =
  | 'general'
  | 'channels'
  | 'limited_channel'
  | 'daily'
  | 'friends'
  | 'twitter'
  | 'bots';

function readInitData(request: Request, body?: Record<string, unknown>): string | null {
  return (
    request.headers.get('x-init-data') ??
    request.headers.get('x-telegram-initdata') ??
    (typeof body?.initData === 'string' ? (body.initData as string) : null)
  );
}

export const mapPublicTask = (t: Record<string, any>) => ({
  id: t.id,
  title: t.title,
  description: t.description ?? '',
  reward: Number(t.reward ?? 0),
  isDaily: Boolean(t.is_daily),
  category: (t.category ?? 'general') as TaskCategory,
  taskType: t.task_type ?? null,
  channelUsername: t.channel_username ?? null,
  joinLink: t.join_link ?? null,
  botUsername: t.bot_username ?? null,
  twitterUrl: t.twitter_url ?? null,
  slotLimit: t.slot_limit ?? null,
  slotsFilled: Number(t.slots_filled ?? 0),
});

/**
 * Ad quota for the "Watch & Earn" task.
 *
 * The quota is calendar-based: every user's counter resets for everyone at the
 * same moment — 00:00 UTC. Watching 6 ads today still means 0/20 tomorrow.
 */
function nextUtcMidnight(now = Date.now()): Date {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0));
}

function currentUtcMidnight(now = Date.now()): Date {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

async function getAdQuota(db: any, telegramId: number) {
  const dayStart = currentUtcMidnight();
  const { count } = await db
    .from('gm_ad_views')
    .select('id', { count: 'exact', head: true })
    .eq('telegram_id', telegramId)
    .gte('created_at', dayStart.toISOString());

  return {
    watched: Number(count ?? 0),
    resetAt: nextUtcMidnight().toISOString() as string | null,
  };
}


async function addCoins(telegramId: number, amount: number) {
  if (!amount) return;
  const db = (await getDb()) as any;
  const { data } = await db
    .from('gm_users')
    .select('coins')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  await db
    .from('gm_users')
    .update({ coins: Number(data?.coins ?? 0) + amount })
    .eq('telegram_id', telegramId);
}

async function listTasks() {
  const db = (await getDb()) as any;
  const { data } = await db
    .from('gm_tasks')
    .select('*')
    .eq('is_hidden', false)
    .eq('is_enabled', true)
    .order('created_at');
  const rows = data ?? [];
  const limited = rows.filter((t: any) => Number(t.slot_limit ?? 0) > 0);
  const counts = new Map<number, number>();
  if (limited.length) {
    const { data: comps } = await db
      .from('gm_task_completions')
      .select('task_id')
      .in('task_id', limited.map((t: any) => t.id));
    for (const c of comps ?? []) {
      const key = Number(c.task_id);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return rows.map((t: any) =>
    mapPublicTask({ ...t, slots_filled: counts.get(Number(t.id)) ?? 0 }),
  );
}

async function getTask(taskId: number) {
  const db = (await getDb()) as any;
  const { data } = await db.from('gm_tasks').select('*').eq('id', taskId).maybeSingle();
  if (!data) return null;
  let filled = 0;
  if (Number(data.slot_limit ?? 0) > 0) {
    const { count } = await db
      .from('gm_task_completions')
      .select('id', { count: 'exact', head: true })
      .eq('task_id', data.id);
    filled = Number(count ?? 0);
  }
  return mapPublicTask({ ...data, slots_filled: filled });
}

/** Records a completion (respecting the 24h daily reset) and pays the reward. */
async function completeTask(telegramId: number, task: ReturnType<typeof mapPublicTask>) {
  const db = (await getDb()) as any;
  const { data: existing } = await db
    .from('gm_task_completions')
    .select('id, completed_at')
    .eq('telegram_id', telegramId)
    .eq('task_id', task.id)
    .maybeSingle();

  if (existing) {
    const age = Date.now() - new Date(existing.completed_at).getTime();
    if (!task.isDaily || age < DAILY_MS) return { ok: false, message: 'already_completed' };
    await db
      .from('gm_task_completions')
      .update({ completed_at: new Date().toISOString() })
      .eq('id', existing.id);
  } else {
    // Slot-limited tasks (e.g. "first 50 joiners only") stop accepting newcomers.
    if (task.slotLimit && task.slotsFilled >= task.slotLimit)
      return { ok: false, message: 'slots_full' };
    await db
      .from('gm_task_completions')
      .insert({ telegram_id: telegramId, task_id: task.id });
    // Auto-close the task once the last slot is taken.
    if (task.slotLimit && task.slotsFilled + 1 >= task.slotLimit) {
      await db.from('gm_tasks').update({ is_enabled: false }).eq('id', task.id);
    }
  }

  await addCoins(telegramId, task.reward);
  // A referral is confirmed once the invited user finished the requirements.
  const { creditReferralIfEligible } = await import('@/lib/referral.server');
  await creditReferralIfEligible(telegramId).catch(() => undefined);
  return { ok: true, coins: task.reward };
}

async function isChannelMember(channel: string, telegramId: number): Promise<boolean> {
  const token = getBotToken();
  if (!token) return false;
  const chat = channel.startsWith('@') || /^-?\d+$/.test(channel) ? channel : `@${channel}`;
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/getChatMember?chat_id=${encodeURIComponent(chat)}&user_id=${telegramId}`,
    );
    const data = (await res.json()) as { ok?: boolean; result?: { status?: string } };
    const status = data?.result?.status ?? '';
    return ['creator', 'administrator', 'member', 'restricted'].includes(status);
  } catch {
    return false;
  }
}

function normalizeBotLink(raw: string): { botUsername: string; payload: string } | null {
  const value = raw.trim();
  const match = value.match(
    /(?:https?:\/\/)?(?:t\.me|telegram\.me|telegram\.dog)\/([A-Za-z0-9_]{4,})\?(?:start|startapp|ref)=([A-Za-z0-9_\-=]+)/i,
  );
  if (!match) return null;
  return { botUsername: match[1].toLowerCase(), payload: match[2] };
}

/** Accepts an admin-configured bot as "@name", "name" or a full t.me link. */
function expectedBotUsername(raw: string | null): string {
  const value = (raw ?? '').trim();
  if (!value) return '';
  const fromLink = value.match(
    /(?:https?:\/\/)?(?:t\.me|telegram\.me|telegram\.dog)\/([A-Za-z0-9_]{4,})/i,
  );
  return (fromLink ? fromLink[1] : value).replace(/^@/, '').replace(/[/?].*$/, '').toLowerCase();
}

export async function handleTasksApi(request: Request, sub: string): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method;
  const body =
    method === 'GET' || method === 'DELETE'
      ? {}
      : ((await request.json().catch(() => ({}))) as Record<string, any>);

  // Public tasks list (no auth needed)
  if (sub === '' && method === 'GET' && url.searchParams.get('type') !== 'combo') {
    return json(await listTasks());
  }

  const auth = resolveTelegramUser(readInitData(request, body));
  if (!auth) return json({ error: 'Unauthorized' }, 401);
  await upsertUser(auth);
  const db = (await getDb()) as any;

  if (sub === 'completed' && method === 'GET') {
    const { data } = await db
      .from('gm_task_completions')
      .select('task_id, completed_at')
      .eq('telegram_id', auth.id);
    const { data: tasks } = await db.from('gm_tasks').select('id, is_daily');
    const dailyMap = new Map<number, boolean>(
      (tasks ?? []).map((t: any) => [Number(t.id), Boolean(t.is_daily)]),
    );
    const rows = (data ?? [])
      .map((r: any) => ({
        taskId: Number(r.task_id),
        completedAt: r.completed_at ?? null,
        isDaily: dailyMap.get(Number(r.task_id)) ?? false,
      }))
      .filter((r: any) => {
        if (!r.isDaily || !r.completedAt) return true;
        return Date.now() - new Date(r.completedAt).getTime() < DAILY_MS;
      });
    return json(rows);
  }

  if (sub === 'submissions' && method === 'GET') {
    const { data } = await db
      .from('gm_task_submissions')
      .select('task_id, kind, payload, status, reject_reason')
      .eq('telegram_id', auth.id);
    return json(
      (data ?? []).map((r: any) => ({
        taskId: Number(r.task_id),
        kind: r.kind,
        payload: r.payload,
        status: r.status,
        rejectReason: r.reject_reason ?? null,
      })),
    );
  }

  if (sub === 'complete' && method === 'POST') {
    const task = await getTask(Number(body.taskId));
    if (!task) return json({ ok: false, message: 'task_not_found' }, 404);
    if (task.channelUsername) return json({ ok: false, message: 'use_verify_channel' }, 400);
    if (task.category === 'twitter' || task.category === 'bots')
      return json({ ok: false, message: 'submission_required' }, 400);
    return json(await completeTask(auth.id, task));
  }

  if (sub === 'verify-channel' && method === 'POST') {
    const task = await getTask(Number(body.taskId));
    if (!task) return json({ ok: false, message: 'task_not_found' }, 404);
    const channel = task.channelUsername;
    if (!channel) return json({ ok: false, message: 'not_a_channel_task' }, 400);
    const joined = await isChannelMember(channel, auth.id);
    if (!joined) return json({ ok: false, message: 'not_joined' });
    return json(await completeTask(auth.id, task));
  }

  // ── X (Twitter) account linking ────────────────────────────────────────────
  // The user links their X handle to the bot once; afterwards every X task is
  // just "open the page → follow → verify".
  if (sub === 'twitter-link' && method === 'GET') {
    const { data } = await db
      .from('gm_users')
      .select('twitter_handle, twitter_linked_at')
      .eq('telegram_id', auth.id)
      .maybeSingle();
    return json({
      handle: data?.twitter_handle ?? null,
      linkedAt: data?.twitter_linked_at ?? null,
    });
  }

  if (sub === 'twitter-link' && method === 'POST') {
    const handle = String(body.handle ?? '')
      .trim()
      .replace(/^https?:\/\/(www\.)?(twitter|x)\.com\//i, '')
      .replace(/^@/, '')
      .replace(/[/?].*$/, '');
    if (!/^[A-Za-z0-9_]{2,20}$/.test(handle))
      return json({ ok: false, message: 'invalid_handle' }, 400);

    // One X account per Telegram account.
    const { data: taken } = await db
      .from('gm_users')
      .select('telegram_id')
      .ilike('twitter_handle', handle)
      .maybeSingle();
    if (taken && Number(taken.telegram_id) !== auth.id)
      return json({ ok: false, message: 'handle_already_linked' }, 400);

    const { error } = await db
      .from('gm_users')
      .update({ twitter_handle: handle, twitter_linked_at: new Date().toISOString() })
      .eq('telegram_id', auth.id);
    if (error) return json({ ok: false, message: 'handle_already_linked' }, 400);
    return json({ ok: true, handle });
  }

  // Verifies an X task after the account is linked and the page was opened.
  if (sub === 'verify-twitter' && method === 'POST') {
    const task = await getTask(Number(body.taskId));
    if (!task) return json({ ok: false, message: 'task_not_found' }, 404);
    if (task.category !== 'twitter') return json({ ok: false, message: 'not_a_twitter_task' }, 400);

    const { data: me } = await db
      .from('gm_users')
      .select('twitter_handle')
      .eq('telegram_id', auth.id)
      .maybeSingle();
    const handle = me?.twitter_handle as string | undefined;
    if (!handle) return json({ ok: false, message: 'twitter_not_linked' }, 400);

    const { data: existing } = await db
      .from('gm_task_submissions')
      .select('id, status')
      .eq('telegram_id', auth.id)
      .eq('task_id', task.id)
      .maybeSingle();
    if (existing?.status === 'approved') return json({ ok: false, message: 'already_completed' });

    const row = {
      status: 'approved',
      payload: handle,
      reject_reason: null,
      reviewed_at: new Date().toISOString(),
    };
    if (existing) {
      await db.from('gm_task_submissions').update(row).eq('id', existing.id);
    } else {
      await db
        .from('gm_task_submissions')
        .insert({ telegram_id: auth.id, task_id: task.id, kind: 'twitter', ...row });
    }

    const result = await completeTask(auth.id, task);
    return json({ ...result, status: 'approved' });
  }

  // Legacy: user submits their X handle → admin reviews it.
  if (sub === 'submit-twitter' && method === 'POST') {
    const task = await getTask(Number(body.taskId));
    if (!task) return json({ ok: false, message: 'task_not_found' }, 404);
    const handle = String(body.handle ?? '')
      .trim()
      .replace(/^https?:\/\/(www\.)?(twitter|x)\.com\//i, '')
      .replace(/^@/, '')
      .replace(/[/?].*$/, '');
    if (!/^[A-Za-z0-9_]{2,20}$/.test(handle))
      return json({ ok: false, message: 'invalid_handle' }, 400);

    const { data: existing } = await db
      .from('gm_task_submissions')
      .select('id, status')
      .eq('telegram_id', auth.id)
      .eq('task_id', task.id)
      .maybeSingle();
    if (existing && existing.status !== 'rejected')
      return json({ ok: false, message: 'already_submitted', status: existing.status });

    if (existing) {
      await db
        .from('gm_task_submissions')
        .update({ payload: handle, status: 'pending', reject_reason: null })
        .eq('id', existing.id);
    } else {
      const { error } = await db
        .from('gm_task_submissions')
        .insert({ telegram_id: auth.id, task_id: task.id, kind: 'twitter', payload: handle });
      if (error) return json({ ok: false, message: 'submit_failed' }, 400);
    }
    return json({ ok: true, status: 'pending' });
  }

  // Bot task: user submits their referral link from the partner bot → auto-verified.
  if (sub === 'submit-bot' && method === 'POST') {
    const task = await getTask(Number(body.taskId));
    if (!task) return json({ ok: false, message: 'task_not_found' }, 404);
    const parsed = normalizeBotLink(String(body.link ?? ''));
    if (!parsed) return json({ ok: false, message: 'invalid_link' }, 400);

    const expected = expectedBotUsername(task.botUsername);
    if (expected && parsed.botUsername !== expected)
      return json({ ok: false, message: 'wrong_bot' }, 400);

    const { data: existing } = await db
      .from('gm_task_submissions')
      .select('id, status')
      .eq('telegram_id', auth.id)
      .eq('task_id', task.id)
      .maybeSingle();
    if (existing && existing.status === 'approved')
      return json({ ok: false, message: 'already_completed' });

    const normalized = `https://t.me/${parsed.botUsername}?start=${parsed.payload}`;
    const { data: dupe } = await db
      .from('gm_task_submissions')
      .select('telegram_id')
      .eq('task_id', task.id)
      .ilike('payload', normalized)
      .maybeSingle();
    if (dupe && Number(dupe.telegram_id) !== auth.id)
      return json({ ok: false, message: 'link_already_used' }, 400);

    if (existing) {
      await db
        .from('gm_task_submissions')
        .update({
          payload: normalized,
          status: 'approved',
          reject_reason: null,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    } else {
      const { error } = await db.from('gm_task_submissions').insert({
        telegram_id: auth.id,
        task_id: task.id,
        kind: 'bot',
        payload: normalized,
        status: 'approved',
        reviewed_at: new Date().toISOString(),
      });
      if (error) return json({ ok: false, message: 'link_already_used' }, 400);
    }

    const result = await completeTask(auth.id, task);
    return json({ ...result, status: 'approved' });
  }

  // ── Daily check-in ─────────────────────────────────────────────────────────
  if (sub === 'checkin' && method === 'GET') {
    return json(await getCheckinState(auth.id));
  }

  if (sub === 'checkin' && method === 'POST') {
    const state = await getCheckinState(auth.id);
    if (!state.canClaim)
      return json({ ok: false, message: 'already_claimed', nextAvailableAt: state.nextAvailableAt });

    const reward = state.reward;
    const { data: row } = await db
      .from('gm_daily_checkins')
      .select('id, total_claims')
      .eq('telegram_id', auth.id)
      .maybeSingle();

    if (row) {
      await db
        .from('gm_daily_checkins')
        .update({
          streak_day: state.nextDay,
          last_claim_at: new Date().toISOString(),
          total_claims: Number(row.total_claims ?? 0) + 1,
        })
        .eq('id', row.id);
    } else {
      await db.from('gm_daily_checkins').insert({
        telegram_id: auth.id,
        streak_day: state.nextDay,
        last_claim_at: new Date().toISOString(),
        total_claims: 1,
      });
    }

    await addCoins(auth.id, reward);
    // A daily check-in can be the last missing referral condition.
    const { creditReferralIfEligible } = await import('@/lib/referral.server');
    await creditReferralIfEligible(auth.id).catch(() => undefined);
    const next = await getCheckinState(auth.id);
    return json({ ok: true, coinsEarned: reward, day: state.nextDay, ...next });

  }

  // ── Ads ────────────────────────────────────────────────────────────────────
  if (sub === 'ads-status' && method === 'GET') {
    const rewardCoins = Number((await getSetting('ad_reward_coins')) ?? 0.5) || 0.5;
    const dailyLimit = Number((await getSetting('ad_daily_limit')) ?? 20) || 20;
    const enabled = (await getSetting('ads_task_enabled')) !== 'false';
    const quota = await getAdQuota(db, auth.id);
    return json({
      enabled,
      watchedToday: quota.watched,
      remainingToday: Math.max(0, dailyLimit - quota.watched),
      resetAt: quota.resetAt,
      rewardCoins,
      dailyLimit,
    });
  }

  if (sub === 'ads-watched' && method === 'POST') {
    // Only the explicit "Watch & Earn" task credits coins (credit: true).
    // The request body was already read above, so reuse it here; reading the
    // stream a second time returns an empty object and incorrectly credits 0.
    const credit = body.credit === true;
    const rewardCoins = Number((await getSetting('ad_reward_coins')) ?? 0.5) || 0.5;
    const dailyLimit = Number((await getSetting('ad_daily_limit')) ?? 20) || 20;
    const watchedToday = (await getAdQuota(db, auth.id)).watched;
    if (watchedToday >= dailyLimit)
      return json({ ok: false, message: 'daily limit reached' }, 400);

    await db.from('gm_ad_views').insert({ telegram_id: auth.id, coins: credit ? rewardCoins : 0 });
    if (credit) await addCoins(auth.id, rewardCoins);
    return json({
      ok: true,
      coinsEarned: credit ? rewardCoins : 0,
      remainingToday: Math.max(0, dailyLimit - watchedToday - 1),
      dailyLimit,
    });
  }


  return json({ error: 'Unsupported request' }, 400);
}
