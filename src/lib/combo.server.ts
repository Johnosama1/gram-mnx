import { json, getSetting, setSetting } from '@/lib/admin.server';
import { resolveTelegramUser, getDb, upsertUser } from '@/lib/telegram-user.server';

const today = () => new Date().toISOString().slice(0, 10);

/** Next daily reset (next UTC midnight) as an ISO timestamp. */
function nextResetAt(): string {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.toISOString();
}

const COMBO_ITEM_IDS = [1, 2, 3, 4, 5];

/** Admin-configurable random reward range for the daily combo. */
export async function getComboRewardRange(): Promise<{ min: number; max: number }> {
  const minRaw = Number(await getSetting('combo_reward_min'));
  const maxRaw = Number(await getSetting('combo_reward_max'));
  let min = Number.isFinite(minRaw) && minRaw > 0 ? Math.floor(minRaw) : 1;
  let max = Number.isFinite(maxRaw) && maxRaw > 0 ? Math.floor(maxRaw) : 10;
  if (max < min) max = min;
  return { min, max };
}

/** Reward amounts 1..10 with an admin-set chance (%) each. 0% never appears. */
export const COMBO_REWARD_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export async function getComboRewardWeights(): Promise<Record<number, number>> {
  let parsed: Record<string, unknown> = {};
  try {
    const raw = await getSetting('combo_reward_weights');
    if (raw) parsed = JSON.parse(raw);
  } catch { parsed = {}; }
  const out: Record<number, number> = {};
  for (const v of COMBO_REWARD_VALUES) {
    const n = Number(parsed[String(v)]);
    out[v] = Number.isFinite(n) && n > 0 ? n : 0;
  }
  return out;
}

export async function setComboRewardWeights(weights: Record<string, unknown>): Promise<Record<number, number>> {
  const clean: Record<number, number> = {};
  for (const v of COMBO_REWARD_VALUES) {
    const n = Number(weights[String(v)]);
    clean[v] = Number.isFinite(n) && n > 0 ? Math.min(100, n) : 0;
  }
  await setSetting('combo_reward_weights', JSON.stringify(clean));
  // Re-pick today's reward immediately so disabled (0%) values disappear at once.
  const reward = await pickReward();
  await setSetting('combo_reward', String(reward));
  return clean;
}

/** Weighted pick honouring admin percentages; falls back to the min–max range. */
async function pickReward(): Promise<number> {
  const weights = await getComboRewardWeights();
  const total = COMBO_REWARD_VALUES.reduce((s, v) => s + weights[v], 0);
  if (total > 0) {
    let r = Math.random() * total;
    for (const v of COMBO_REWARD_VALUES) {
      r -= weights[v];
      if (r < 0) return v;
    }
    return COMBO_REWARD_VALUES.find((v) => weights[v] > 0) ?? 1;
  }
  const range = await getComboRewardRange();
  return range.min + Math.floor(Math.random() * (range.max - range.min + 1));
}

/**
 * Rotates the daily combo automatically: 3 random items and a random
 * 1–10 coin reward, regenerated once per calendar day (24h).
 */
export async function ensureDailyCombo(): Promise<{ correctIds: number[]; reward: number }> {
  const date = today();
  const storedDate = await getSetting('combo_date');
  const ansRaw = await getSetting('combo_answer');
  const rewardRaw = await getSetting('combo_reward');
  let correctIds: number[] = [];
  try { correctIds = ansRaw ? JSON.parse(ansRaw) : []; } catch { correctIds = []; }

  if (storedDate === date && correctIds.length === 3) {
    let reward = Number(rewardRaw ?? 1) || 1;
    const weights = await getComboRewardWeights();
    const total = COMBO_REWARD_VALUES.reduce((s, v) => s + weights[v], 0);
    // If admin set percentages and the cached reward is now disabled (0%), re-pick.
    if (total > 0 && !(weights[reward] > 0)) {
      reward = await pickReward();
      await setSetting('combo_reward', String(reward));
    }
    return { correctIds, reward };
  }


  const pool = [...COMBO_ITEM_IDS];
  const picked: number[] = [];
  while (picked.length < 3 && pool.length) {
    picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  picked.sort((a, b) => a - b);
  // Admin-configurable chances per reward value (fallback: min–max range).
  const reward = await pickReward();

  await setSetting('combo_date', date);
  await setSetting('combo_answer', JSON.stringify(picked));
  await setSetting('combo_reward', String(reward));
  return { correctIds: picked, reward };
}

export async function handleComboRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const type = url.searchParams.get('type');
  if (type !== 'combo') return json({ error: 'Unsupported request' }, 400);

  const initData = request.headers.get('x-telegram-initdata');
  const auth = resolveTelegramUser(initData);
  if (!auth) return json({ error: 'Unauthorized' }, 401);

  const db = (await getDb()) as any;
  await upsertUser(auth);
  const date = today();
  const daily = await ensureDailyCombo();

  if (request.method === 'GET') {
    const { data } = await db
      .from('gm_combo_attempts')
      .select('success,reward')
      .eq('telegram_id', auth.id)
      .eq('combo_date', date)
      .maybeSingle();
    return json({
      attemptedToday: Boolean(data),
      success: data ? data.success : null,
      reward: data ? data.reward : null,
      dailyReward: daily.reward,
      // Reveal today's answer only after the user has already attempted.
      correctIds: data ? daily.correctIds : null,
      nextResetAt: nextResetAt(),
    });
  }

  if (request.method === 'POST' && url.searchParams.get('action') === 'submit') {
    const body = (await request.json().catch(() => ({}))) as { selectedIds?: number[] };
    const selected = Array.isArray(body.selectedIds) ? body.selectedIds.map(Number) : [];
    if (selected.length !== 3) return json({ error: 'select_three' }, 400);

    const { data: existing } = await db
      .from('gm_combo_attempts')
      .select('id')
      .eq('telegram_id', auth.id)
      .eq('combo_date', date)
      .maybeSingle();
    if (existing) return json({ error: 'already_attempted' }, 400);

    const correctIds = daily.correctIds;
    const reward = daily.reward;

    if (correctIds.length === 0) {
      await db
        .from('gm_combo_attempts')
        .insert({ telegram_id: auth.id, combo_date: date, success: false, reward: 0 });
      return json({ ok: true, success: false, reward: 0, reason: 'no_combo_set', nextResetAt: nextResetAt() });
    }

    const success =
      selected.length === correctIds.length &&
      [...selected].sort().join(',') === [...correctIds].sort().join(',');
    const gained = success ? reward : 0;

    await db
      .from('gm_combo_attempts')
      .insert({ telegram_id: auth.id, combo_date: date, success, reward: gained });

    if (gained > 0) {
      const { data: u } = await db
        .from('gm_users')
        .select('coins')
        .eq('telegram_id', auth.id)
        .maybeSingle();
      await db
        .from('gm_users')
        .update({ coins: Number(u?.coins ?? 0) + gained })
        .eq('telegram_id', auth.id);
    }

    if (success) {
      const { creditReferralIfEligible } = await import('@/lib/referral.server');
      await creditReferralIfEligible(auth.id).catch(() => undefined);
    }

    return json({ ok: true, success, reward: gained, nextResetAt: nextResetAt() });
  }

  return json({ error: 'Method not allowed' }, 405);
}

export { setSetting };
