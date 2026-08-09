import { json, getSetting, notifyUser } from '@/lib/admin.server';
import { getDb, resolveTelegramUser, upsertUser } from '@/lib/telegram-user.server';
import { getDepositWallet, getWalletBalanceTon, normalizeAddress } from '@/lib/ton.server';
import { getGramToCoins } from '@/lib/swap.server';
import { reqLang, tr } from '@/lib/i18n.server';

const DEFAULT_MIN_DEPOSIT = 1;

function getInitData(request: Request, body?: { initData?: string }) {
  return (
    body?.initData ??
    request.headers.get('x-init-data') ??
    request.headers.get('x-telegram-initdata')
  );
}

export async function getMinDeposit(): Promise<number> {
  const n = Number(await getSetting('min_deposit'));
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MIN_DEPOSIT;
}

/** حد المحاولات المشبوهة قبل الحظر التلقائي. */
const FRAUD_BAN_THRESHOLD = 5;

/**
 * يسجّل محاولة تلاعب (إيداع من محفظة غير مربوطة) ويحظر الحساب تلقائيًا
 * بعد تكرارها. يرجع true لو تم الحظر.
 */
async function registerFraudAttempt(db: any, telegramId: number, kind: string): Promise<boolean> {
  await db
    .from('gm_support_messages')
    .insert({
      telegram_id: telegramId,
      kind: 'fraud',
      message: `Rejected deposit attempt (${kind})`,
      status: 'new',
    })
    .then(() => undefined, () => undefined);

  const { count } = await db
    .from('gm_support_messages')
    .select('id', { count: 'exact', head: true })
    .eq('telegram_id', telegramId)
    .eq('kind', 'fraud');

  if (Number(count ?? 0) >= FRAUD_BAN_THRESHOLD) {
    await db.from('gm_users').update({ is_banned: true }).eq('telegram_id', telegramId);
    return true;
  }
  return false;
}


/** POST /api/telegram/deposit/tonconnect — prepares, confirms, or cancels one deposit intent. */
export async function handleDepositTonconnect(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    initData?: string;
    action?: 'prepare' | 'confirm' | 'cancel';
    requestId?: number;
    amountGram?: number;
    from?: string;
    boc?: string;
    lang?: string;
  };
  const lang = reqLang(request, body);
  const user = resolveTelegramUser(getInitData(request, body));
  if (!user) return json({ message: 'Invalid initData' }, 401);

  await upsertUser(user);
  const db = (await getDb()) as any;

  if (body.action === 'cancel') {
    const requestId = Number(body.requestId);
    if (Number.isInteger(requestId) && requestId > 0) {
      await db
        .from('gm_deposits')
        .update({
          status: 'rejected',
          rejection_reason: tr('en', 'deposit_cancelled_reason'),
          processed_at: new Date().toISOString(),
        })
        .eq('id', requestId)
        .eq('telegram_id', user.id)
        .eq('status', 'pending');
    }
    return json({ ok: true });
  }

  const amount = Number(body.amountGram);
  if (!Number.isFinite(amount) || amount <= 0) return json({ ok: false, message: tr(lang, 'invalid_amount') }, 400);

  const min = await getMinDeposit();
  if (amount < min) return json({ ok: false, message: tr(lang, 'min_deposit', { min }) }, 400);

  if (!getDepositWallet()) return json({ ok: false, message: tr(lang, 'deposit_wallet_missing') }, 500);

  const { data: row } = await db
    .from('gm_users')
    .select('balance, coins, wallet_address')
    .eq('telegram_id', user.id)
    .maybeSingle();

  // الإيداع مسموح فقط من المحفظة المربوطة بالحساب.
  const linked = String(row?.wallet_address ?? '').trim();
  if (!linked) {
    return json({ ok: false, message: tr(lang, 'link_wallet_first') }, 400);
  }

  const linkedRaw = await normalizeAddress(linked);
  if (!linkedRaw) return json({ ok: false, message: tr(lang, 'linked_wallet_invalid') }, 400);

  // لو المحفظة المتصلة حاليًا مختلفة عن المربوطة نرفض العملية ونسجّل المحاولة.
  if (body.from) {
    const fromRaw = await normalizeAddress(String(body.from).trim());
    if (!fromRaw || fromRaw !== linkedRaw) {
      const banned = await registerFraudAttempt(db, user.id, 'wallet_mismatch');
      return json(
        {
          ok: false,
          message: banned ? tr(lang, 'banned_fraud') : tr(lang, 'wallet_mismatch'),
        },
        403,
      );
    }
  }


  const sender = linked;

  if (body.action === 'prepare') {
    // التحقق من رصيد المحفظة على البلوك تشين قبل السماح بالإيداع.
    const onchain = await getWalletBalanceTon(linked);
    if (onchain !== null && onchain < amount) {
      return json(
        {
          ok: false,
          message: tr(lang, 'onchain_insufficient', { onchain: onchain.toFixed(4), amount, fee: '0' }),
        },
        400,
      );
    }

    const requestToken = `pending:${user.id}:${Date.now()}:${crypto.randomUUID()}`;
    const { data: pending, error } = await db
      .from('gm_deposits')
      .insert({
        telegram_id: user.id,
        wallet_address: sender,
        tx_hash: requestToken,
        amount,
        status: 'pending',
      })
      .select('id')
      .maybeSingle();
    if (error || !pending?.id) {
      return json({ ok: false, message: tr(lang, 'deposit_prepare_failed') }, 500);
    }
    return json({ ok: true, requestId: pending.id });
  }


  const requestId = Number(body.requestId);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return json({ ok: false, message: tr(lang, 'deposit_request_invalid') }, 400);
  }

  // No signed transaction = the user never actually paid.
  const boc = typeof body.boc === 'string' ? body.boc.trim() : '';
  if (!boc) {
    return json({ ok: false, message: tr(lang, 'deposit_no_transfer') }, 400);
  }

  // Mark the previously prepared intent as signed. The chain transaction hash
  // replaces this temporary BOC fingerprint when the scanner confirms it.
  const { data: pending, error: confirmError } = await db
    .from('gm_deposits')
    .update({ tx_hash: `signed:${requestId}:${boc.slice(0, 72)}` })
    .eq('id', requestId)
    .eq('telegram_id', user.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (confirmError || !pending?.id) {
    const { data: existing } = await db
      .from('gm_deposits')
      .select('status')
      .eq('id', requestId)
      .eq('telegram_id', user.id)
      .maybeSingle();
    if (existing?.status === 'confirmed') {
      const { data: creditedUser } = await db
        .from('gm_users')
        .select('balance, coins')
        .eq('telegram_id', user.id)
        .maybeSingle();
      const credited = Math.floor(amount * (await getGramToCoins()));
      return json({
        ok: true,
        balance: Number(creditedUser?.balance ?? 0),
        coins: Number(creditedUser?.coins ?? 0),
        message: tr(lang, 'deposit_confirmed', { coins: credited }),
      });
    }
    return json({ ok: false, message: tr(lang, 'deposit_link_failed') }, 409);
  }

  await notifyUser(
    user.id,
    tr('en', 'deposit_notify_pending', { amount }),
  ).catch(() => undefined);

  // Try to settle right away; the transfer may need a few seconds to confirm.
  const { scanDeposits } = await import('@/lib/deposit-scan.server');
  let settled = false;
  for (let i = 0; i < 4 && !settled; i++) {
    if (i) await new Promise((r) => setTimeout(r, 2500));
    await scanDeposits(30).catch(() => undefined);
    const { data: current } = await db
      .from('gm_deposits')
      .select('status')
      .eq('id', requestId)
      .maybeSingle();
    settled = current?.status === 'confirmed';
  }

  const { data: after } = await db
    .from('gm_users')
    .select('balance, coins')
    .eq('telegram_id', user.id)
    .maybeSingle();

  if (!settled) {
    return json({
      ok: false,
      pending: true,
      balance: Number(after?.balance ?? 0),
      message: tr(lang, 'deposit_verifying'),
    });
  }

  return json({
    ok: true,
    balance: Number(after?.balance ?? 0),
    coins: Number(after?.coins ?? 0),
    message: tr(lang, 'deposit_confirmed', { coins: Math.floor(amount * (await getGramToCoins())) }),
  });
}

/** GET /api/telegram/deposit/status — recent deposits. */
export async function handleDepositStatus(request: Request) {
  const user = resolveTelegramUser(getInitData(request));
  if (!user) return json({ message: 'Invalid initData' }, 401);

  // Opportunistic scan so deposits are credited without any manual step.
  try {
    const { scanDeposits } = await import('@/lib/deposit-scan.server');
    await scanDeposits(30);
  } catch {
    /* never block the history read on a chain hiccup */
  }

  const db = (await getDb()) as any;
  const { data } = await db
    .from('gm_deposits')
    .select('id, amount, status, created_at')
    .eq('telegram_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20);
  return json(data ?? []);
}