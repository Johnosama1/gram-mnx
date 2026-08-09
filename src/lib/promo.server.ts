import { json, getSetting } from '@/lib/admin.server';
import { getDb, resolveTelegramUser, upsertUser } from '@/lib/telegram-user.server';

export type PromoCodeRow = {
  id: number;
  code: string;
  rewardCoins: number;
  maxUses: number;
  currentUses: number;
  isActive: boolean;
  createdAt: string;
};

export const mapPromoCode = (r: Record<string, any>): PromoCodeRow => ({
  id: Number(r.id),
  code: String(r.code),
  rewardCoins: Number(r.reward_coins ?? 0),
  maxUses: Number(r.max_uses ?? 0),
  currentUses: Number(r.current_uses ?? 0),
  isActive: Boolean(r.is_active),
  createdAt: r.created_at,
});

/** Whether the promo-code card is visible in the user's Tasks tab. */
export async function isPromoSectionEnabled(): Promise<boolean> {
  return (await getSetting('promo_section_enabled')) !== 'false';
}

async function addCoins(telegramId: number, amount: number) {
  if (!amount) return;
  const db = (await getDb()) as any;
  const { data } = await db
    .from('gm_users')
    .select('coins')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  const next = Number(data?.coins ?? 0) + amount;
  await db.from('gm_users').update({ coins: next }).eq('telegram_id', telegramId);
}

/**
 * User-facing promo API.
 *  GET  → { enabled }
 *  POST → redeem a code (called only AFTER the rewarded ad completed client-side)
 */
export async function handlePromoApi(request: Request): Promise<Response> {
  const method = request.method;
  const body =
    method === 'GET' ? {} : ((await request.json().catch(() => ({}))) as Record<string, any>);

  const initData =
    request.headers.get('x-init-data') ??
    request.headers.get('x-telegram-initdata') ??
    (typeof body.initData === 'string' ? body.initData : null);

  const enabled = await isPromoSectionEnabled();
  if (method === 'GET') return json({ enabled });

  const auth = resolveTelegramUser(initData);
  if (!auth) return json({ error: 'Unauthorized' }, 401);
  await upsertUser(auth);
  if (!enabled) return json({ ok: false, message: 'promo_disabled' }, 400);

  const code = String(body.code ?? '').trim();
  if (!code) return json({ ok: false, message: 'promo_invalid' }, 400);

  const db = (await getDb()) as any;
  const { data: row } = await db
    .from('gm_promo_codes')
    .select('*')
    .ilike('code', code)
    .maybeSingle();

  if (!row || row.is_active === false) return json({ ok: false, message: 'promo_invalid' }, 400);

  const { data: used } = await db
    .from('gm_promo_redemptions')
    .select('id')
    .eq('telegram_id', auth.id)
    .eq('code_id', row.id)
    .maybeSingle();
  if (used) return json({ ok: false, message: 'promo_already_used' }, 400);

  const maxUses = Number(row.max_uses ?? 0);
  const currentUses = Number(row.current_uses ?? 0);
  if (maxUses > 0 && currentUses >= maxUses)
    return json({ ok: false, message: 'promo_full' }, 400);

  const reward = Number(row.reward_coins ?? 0);

  // Validation-only pass: the client shows the rewarded ad next and calls
  // again with { code } to actually credit the reward.
  if (body.check === true) return json({ ok: true, valid: true, rewardCoins: reward });

  // The unique (telegram_id, code_id) index makes a double-tap safe.
  const { error } = await db
    .from('gm_promo_redemptions')
    .insert({ telegram_id: auth.id, code_id: row.id, reward_coins: reward });
  if (error) return json({ ok: false, message: 'promo_already_used' }, 400);

  const nextUses = currentUses + 1;
  await db
    .from('gm_promo_codes')
    .update({
      current_uses: nextUses,
      is_active: maxUses > 0 && nextUses >= maxUses ? false : row.is_active,
    })
    .eq('id', row.id);

  await addCoins(auth.id, reward);

  return json({ ok: true, coinsEarned: reward, code: row.code });
}
