import { json, getSetting } from '@/lib/admin.server';
import { getDb, resolveTelegramUser, upsertUser } from '@/lib/telegram-user.server';
import { rateLimit } from '@/lib/rate-limit.server';

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

/** Whether redeeming a code requires watching a rewarded ad first (AdsGram). */
async function isPromoAdEnabled(): Promise<boolean> {
  return (await getSetting('promo_ad_enabled')) !== 'false';
}

type PromoRedeemResult = { status: string; reward_coins: number; code: string };

/**
 * Pre-atomic read-check-write sequence, kept only as a fallback for when
 * gm_redeem_promo_code is unreachable (PostgREST reports PGRST202 when a
 * migration that should have created it was never applied, or its schema
 * cache hasn't picked it up yet). Without this fallback a missing migration
 * would hard-fail every redemption with "server busy" instead of degrading
 * to the same non-atomic behavior the app already ran on before that
 * migration shipped — this loses the row lock's protection against two
 * simultaneous redemptions of the very same code, an acceptable trade next
 * to promo codes not working at all.
 */
async function redeemPromoCodeFallback(
  db: any,
  telegramId: number,
  code: string,
): Promise<PromoRedeemResult | undefined> {
  const { data: row } = await db
    .from('gm_promo_codes')
    .select('*')
    .eq('code', code.toUpperCase())
    .maybeSingle();
  if (!row) return { status: 'invalid', reward_coins: 0, code };

  const maxUses = Number(row.max_uses ?? 0);
  const currentUses = Number(row.current_uses ?? 0);
  if (maxUses > 0 && currentUses >= maxUses) return { status: 'full', reward_coins: 0, code };
  if (row.is_active === false) return { status: 'invalid', reward_coins: 0, code };

  const { error: insertError } = await db
    .from('gm_promo_redemptions')
    .insert({ telegram_id: telegramId, code_id: row.id, reward_coins: row.reward_coins });
  if (insertError) {
    if (insertError.code === '23505') return { status: 'already_used', reward_coins: 0, code };
    console.error('[promo] fallback insert failed', insertError);
    return undefined;
  }

  await db
    .from('gm_promo_codes')
    .update({
      current_uses: currentUses + 1,
      is_active: maxUses > 0 && currentUses + 1 >= maxUses ? false : row.is_active,
    })
    .eq('id', row.id);

  const rewardCoins = Number(row.reward_coins ?? 0);
  if (rewardCoins > 0) await db.rpc('gm_add_coins', { _telegram_id: telegramId, _amount: rewardCoins });

  return { status: 'ok', reward_coins: rewardCoins, code: row.code };
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
  if (method === 'GET') {
    const { getAdsGramBlockId } = await import('@/lib/adsgram.server');
    const [adEnabled, blockId] = await Promise.all([isPromoAdEnabled(), getAdsGramBlockId()]);
    return json({ enabled, adEnabled, blockId });
  }

  const auth = resolveTelegramUser(initData);
  if (!auth) return json({ error: 'Unauthorized' }, 401);
  await upsertUser(auth);
  if (!enabled) return json({ ok: false, message: 'promo_disabled' }, 400);

  const code = String(body.code ?? '')
    .trim()
    .slice(0, 64);
  if (!code) return json({ ok: false, message: 'promo_invalid' }, 400);
  // Brute-force guard on code guessing — distinct from "invalid code" so the
  // client never shows a genuinely valid code as broken just because this
  // one user is retrying too fast.
  if (!(await rateLimit(`promo:${auth.id}`, 15, 60)))
    return json({ ok: false, message: 'promo_busy' }, 429);

  const db = (await getDb()) as any;

  // Validation-only pass (client shows this before crediting): a plain read,
  // never writes, so it's never part of the redemption race.
  if (body.check === true) {
    // Codes are always stored upper-cased at creation time (admin-general.server.ts),
    // so an exact match on the upper-cased input is equivalent to the old
    // case-insensitive ILIKE — but it can use a plain index instead of a scan.
    const { data: row } = await db
      .from('gm_promo_codes')
      .select('*')
      .eq('code', code.toUpperCase())
      .maybeSingle();
    if (!row) return json({ ok: false, message: 'promo_invalid' }, 400);

    const { data: used } = await db
      .from('gm_promo_redemptions')
      .select('id')
      .eq('telegram_id', auth.id)
      .eq('code_id', row.id)
      .maybeSingle();
    if (used) return json({ ok: false, message: 'promo_already_used' }, 400);

    // Checked before is_active: a code that hit max_uses auto-deactivates,
    // so an inactive row can mean "full" as much as "genuinely disabled" —
    // those get different messages.
    const maxUses = Number(row.max_uses ?? 0);
    const currentUses = Number(row.current_uses ?? 0);
    if (maxUses > 0 && currentUses >= maxUses)
      return json({ ok: false, message: 'promo_full' }, 400);
    if (row.is_active === false) return json({ ok: false, message: 'promo_invalid' }, 400);

    return json({ ok: true, valid: true, rewardCoins: Number(row.reward_coins ?? 0) });
  }

  // Real redemption: one atomic, row-locked DB call (gm_redeem_promo_code)
  // instead of a read-check-then-write sequence. That sequence is exactly
  // what raced under many users redeeming the same code at once — every
  // concurrent request read the same current_uses before any of them wrote
  // it back, so uses could be lost/over-counted, and the request just held
  // its DB connection open longer than necessary under the contention that
  // caused. Same outcomes (invalid/already used/full/success), same reward
  // amount, just computed atomically.
  const { data: result, error } = await db.rpc('gm_redeem_promo_code', {
    _telegram_id: auth.id,
    _code: code,
  });

  let settled: PromoRedeemResult | undefined;
  if (error) {
    if (error.code === 'PGRST202') {
      console.error(
        '[promo] gm_redeem_promo_code not found — falling back to the non-atomic path; ' +
          'run supabase/migrations/20260822070000_atomic_promo_redeem.sql',
      );
      settled = await redeemPromoCodeFallback(db, auth.id, code);
    } else {
      console.error('[promo] redeem failed', error);
      return json({ ok: false, message: 'promo_busy' }, 500);
    }
  } else {
    settled = Array.isArray(result) ? result[0] : result;
  }

  if (!settled) return json({ ok: false, message: 'promo_busy' }, 500);
  if (settled.status === 'invalid') return json({ ok: false, message: 'promo_invalid' }, 400);
  if (settled.status === 'already_used') return json({ ok: false, message: 'promo_already_used' }, 400);
  if (settled.status === 'full') return json({ ok: false, message: 'promo_full' }, 400);

  return json({
    ok: true,
    coinsEarned: Number(settled.reward_coins ?? 0),
    code: settled.code ?? code,
  });
}
