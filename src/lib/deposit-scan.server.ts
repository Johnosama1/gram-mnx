/**
 * Automatic TON deposit watcher.
 *
 * It NEVER invents deposits: a transfer is credited only when it matches a
 * deposit request the user actually created in the mini app (a `pending` row in
 * gm_deposits) — same sender wallet and same amount. Each on-chain transaction
 * is stored by hash so it can only ever be credited once.
 */
import { notifyUser, getSetting, getAllAdminIds } from '@/lib/admin.server';
import { getDb } from '@/lib/telegram-user.server';
import { normalizeAddress } from '@/lib/ton.server';
import { getGramToCoins } from '@/lib/swap.server';
import { fetchIncomingTransfers, type IncomingTx } from '@/lib/ton-incoming.server';
import { creditReferralIfEligible } from '@/lib/referral.server';

const round12 = (n: number) => Math.round(n * 1_000_000_000_000) / 1_000_000_000_000;

/** TON Connect sends the requested value exactly; only allow sub-micro rounding noise. */
const AMOUNT_TOLERANCE = 0.000001;

/** A deposit request is only settled by a transfer that arrives within 15 minutes. */
const REQUEST_TTL_MS = 15 * 60 * 1000;


export type ScanResult = {
  scanned: number;
  credited: number;
  totalGram: number;
  totalCoins: number;
  skipped: number;
  unmatched: number;
};

type PendingRequest = {
  id: number;
  telegram_id: number;
  wallet_address: string | null;
  amount: number;
  created_at: string;
};

function amountMatches(requested: number, onchain: number) {
  // المبلغ الواصل لازم يساوي المطلوب بالظبط (مع تسامح ميكروي فقط) — الأقل مرفوض.
  return (
    onchain >= requested - AMOUNT_TOLERANCE &&
    onchain <= requested + AMOUNT_TOLERANCE
  );
}


/** Credits exactly the requested amount of one pending deposit request. */
async function creditPending(db: any, req: PendingRequest, tx: IncomingTx, rate: number) {
  const { data: user } = await db
    .from('gm_users')
    .select('balance, coins, referred_by, wallet_address, username, first_name')
    .eq('telegram_id', req.telegram_id)
    .maybeSingle();
  if (!user) return null;

  // التحقق النهائي: المُرسِل لازم يكون نفس المحفظة المربوطة بالحساب.
  const linked = user.wallet_address ? await normalizeAddress(String(user.wallet_address)) : null;
  const sender = await normalizeAddress(tx.from);
  if (!linked || !sender || linked !== sender) return null;


  // Credit what the user asked for, never more than what actually arrived.
  const amount = round12(Math.min(Number(req.amount), tx.amountTon));
  const coins = Math.floor(amount * rate);
  const newCoins = round12(Number(user.coins ?? 0) + coins);
  const nowIso = new Date().toISOString();

  const { data: claimed, error } = await db
    .from('gm_deposits')
    .update({
      wallet_address: tx.from,
      tx_hash: tx.txHash,
      amount,
      status: 'confirmed',
      confirmations: 1,
      credited_at: nowIso,
      processed_at: nowIso,
    })
    .eq('id', req.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  // Another concurrent scanner may have claimed it first.
  if (error || !claimed?.id) return null;

  // Atomic credit: a plain read-modify-write could lose a concurrent update.
  await db.rpc('gm_add_coins', { _telegram_id: req.telegram_id, _amount: coins });

  await notifyUser(
    req.telegram_id,
    `✅ Your deposit was received.\n💰 <b>${coins} Coin</b> was added to your balance.`,
  ).catch(() => undefined);

  // Notify every admin with the full deposit details.
  try {
    const name = String(user.first_name ?? '').trim() || 'User';
    const handle = user.username ? `@${user.username}` : '—';
    const link = `https://tonviewer.com/transaction/${encodeURIComponent(tx.txHash)}`;
    const text =
      `💎 <b>New deposit</b>\n` +
      `👤 User: ${name} (${handle})\n` +
      `🆔 <code>${req.telegram_id}</code>\n` +
      `👛 Wallet: <code>${tx.from}</code>\n` +
      `💰 Amount: <b>${amount} GRAM</b>\n` +
      `🪙 Coins credited: <b>${coins} Coin</b>\n` +
      `🔗 Transaction: <a href="${link}">${tx.txHash}</a>`;
    const admins = await getAllAdminIds();
    await Promise.all(admins.map((id) => notifyUser(id, text).catch(() => undefined)));
  } catch {
    // Admin notification must never block crediting.
  }

  // A deposit alone confirms the referral, even if the other conditions are unmet.
  await creditReferralIfEligible(req.telegram_id).catch(() => undefined);

  // Referral commission: the inviter earns 10% of the invited user's deposit (in coins).
  const referrerId = Number((user as { referred_by?: number | null }).referred_by ?? 0);
  const bonus = round12(coins * 0.1);
  if (Number.isFinite(referrerId) && referrerId > 0 && bonus > 0) {
    const { data: refRow } = await db
      .from('gm_users')
      .select('telegram_id')
      .eq('telegram_id', referrerId)
      .maybeSingle();
    if (refRow) {
      await db.rpc('gm_add_coins', { _telegram_id: referrerId, _amount: bonus });
      await notifyUser(
        referrerId,
        `🎁 <b>10% referral commission added</b>\n💰 You earned <b>${bonus} Coin</b> because your friend made a deposit.`,
      ).catch(() => undefined);
    }
  }

  return { amount, coins };
}

/**
 * Scans confirmed incoming transfers and settles matching deposit requests.
 * Transfers with no matching request are ignored (never credited).
 */
export async function scanDeposits(limit = 50): Promise<ScanResult> {
  const result: ScanResult = {
    scanned: 0,
    credited: 0,
    totalGram: 0,
    totalCoins: 0,
    skipped: 0,
    unmatched: 0,
  };

  const db = (await getDb()) as any;

  // Nothing to settle without an open request.
  const { data: pendingRows } = await db
    .from('gm_deposits')
    .select('id, telegram_id, wallet_address, amount, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(200);
  const pending = (pendingRows ?? []) as PendingRequest[];
  if (!pending.length) return result;

  // Requests the user never paid for (cancelled / no funds) must never be settled
  // later by an unrelated transfer.
  const now = Date.now();
  const expired = pending.filter((p) => now - new Date(p.created_at).getTime() > REQUEST_TTL_MS);
  if (expired.length) {
    await db
      .from('gm_deposits')
      .update({
        status: 'rejected',
        rejection_reason: 'No matching transfer arrived — the request expired',
        processed_at: new Date().toISOString(),
      })
      .in('id', expired.map((p) => p.id))
      .eq('status', 'pending');
  }
  const live = pending.filter((p) => now - new Date(p.created_at).getTime() <= REQUEST_TTL_MS);
  if (!live.length) return result;

  const cutoff = Number(await getSetting('deposit_scan_from')) || 0;
  const txs = (await fetchIncomingTransfers(limit)).filter((t) => t.utime >= cutoff);
  result.scanned = txs.length;
  if (!txs.length) return result;

  // Hashes already tied to a deposit row are never reprocessed.
  const { data: known } = await db
    .from('gm_deposits')
    .select('tx_hash')
    .in('tx_hash', txs.map((t) => t.txHash));
  const seen = new Set((known ?? []).map((r: { tx_hash: string }) => r.tx_hash));

  const rate = await getGramToCoins();
  const openRequests = [...live];

  for (const tx of txs) {
    if (seen.has(tx.txHash)) {
      result.skipped++;
      continue;
    }
    const sender = await normalizeAddress(tx.from);
    if (!sender) {
      result.unmatched++;
      continue;
    }

    // Oldest open request from this exact wallet with a matching amount.
    let index = -1;
    for (let i = 0; i < openRequests.length; i++) {
      const req = openRequests[i]!;
      const reqWallet = req.wallet_address ? await normalizeAddress(req.wallet_address) : null;
      if (reqWallet !== sender) continue;
      if (!amountMatches(Number(req.amount), tx.amountTon)) continue;
      // The transfer must have happened after the request was created.
      if (tx.utime * 1000 < new Date(req.created_at).getTime()) continue;
      index = i;
      break;
    }
    if (index < 0) {
      result.unmatched++;
      continue;
    }

    const req = openRequests[index]!;
    const credited = await creditPending(db, req, tx, rate);
    seen.add(tx.txHash);
    openRequests.splice(index, 1);
    if (credited) {
      result.credited++;
      result.totalGram = round12(result.totalGram + credited.amount);
      result.totalCoins += credited.coins;
    }
  }

  return result;
}
