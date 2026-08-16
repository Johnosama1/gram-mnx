import { getAllAdminIds, getBotToken } from '@/lib/admin.server';
import { getDb } from '@/lib/telegram-user.server';

const E = {
  bell: '<tg-emoji emoji-id="5852804431644465571">☑️</tg-emoji>',
  user: '<tg-emoji emoji-id="5260399854500191689">👤</tg-emoji>',
  id: '<tg-emoji emoji-id="5422683699130933153">🪪</tg-emoji>',
  gem: '<tg-emoji emoji-id="5945101187186433635">💎</tg-emoji>',
  wallet: '<tg-emoji emoji-id="5039557485157942342">👛</tg-emoji>',
};

export type PendingWithdraw = {
  requestId: number;
  telegramId: number;
  username?: string | null;
  amount: number;
  wallet: string;
  note?: string | null;
};

async function sendToAdmin(chatId: number, text: string, reply_markup?: unknown) {
  const token = getBotToken();
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(reply_markup ? { reply_markup } : {}),
    }),
  }).catch(() => {});
}

/** Notifies every admin in the bot chat with inline approve/reject buttons. */
export async function notifyAdminsPendingWithdraw(info: PendingWithdraw) {
  try {
    const tag = info.username ? `@${String(info.username).replace(/^@/, '')}` : String(info.telegramId);
    const lines = [
      `${E.bell} <b>New withdrawal request #${info.requestId}</b>`,
      '',
      `${E.user} ${tag}`,
      `${E.id} <code>${info.telegramId}</code>`,
      `${E.gem} ${Number(info.amount)} GRAM`,
      `${E.wallet} <code>${info.wallet}</code>`,
    ];
    if (info.note) lines.push('', `⚠️ ${info.note}`);
    const reply_markup = {
      inline_keyboard: [
        [
          { text: '✅ Approve & send', callback_data: `wd:approve:${info.requestId}`, style: 'success' },
          { text: '❌ Reject', callback_data: `wd:reject:${info.requestId}`, style: 'danger' },
        ],
      ],
    };
    await Promise.all(
      (await getAllAdminIds()).map((adminId) => sendToAdmin(adminId, lines.join('\n'), reply_markup)),
    );
  } catch (err) {
    console.error('notifyAdminsPendingWithdraw failed:', err);
  }
}

export type ReviewResult = { ok: boolean; message: string };

/** Informs every admin about the outcome of a review (who did what). */
export async function announceReviewToAdmins(opts: {
  requestId: number;
  action: 'approve' | 'reject';
  ok: boolean;
  message: string;
  actorId?: number | null;
  actorName?: string | null;
  amount?: number | null;
  telegramId?: number | null;
  excludeAdminId?: number | null;
}) {
  try {
    const icon = opts.ok ? (opts.action === 'approve' ? '✅' : '❌') : '⚠️';
    const verb = opts.action === 'approve' ? 'Approved' : 'Rejected';
    const actor = opts.actorName
      ? `${opts.actorName}${opts.actorId ? ` (<code>${opts.actorId}</code>)` : ''}`
      : opts.actorId
        ? `<code>${opts.actorId}</code>`
        : 'Admin panel';
    const lines = [
      `${icon} <b>${opts.ok ? verb : 'Failed to process'} withdrawal #${opts.requestId}</b>`,
      '',
      `${E.user} By: ${actor}`,
    ];
    if (opts.telegramId) lines.push(`${E.id} User: <code>${opts.telegramId}</code>`);
    if (opts.amount != null) lines.push(`${E.gem} ${Number(opts.amount)} GRAM`);
    lines.push('', opts.message);
    await Promise.all(
      (await getAllAdminIds())
        .filter((adminId) => !opts.excludeAdminId || adminId !== opts.excludeAdminId)
        .map((adminId) => sendToAdmin(adminId, lines.join('\n'))),
    );
  } catch (err) {
    console.error('announceReviewToAdmins failed:', err);
  }
}

/**
 * Approves (with on-chain payout when configured) or rejects a pending
 * withdrawal. Shared by the admin panel API and the bot inline buttons.
 */
export async function reviewWithdrawal(
  id: number,
  action: 'approve' | 'reject',
  reason?: string,
  actor?: { id?: number | null; name?: string | null },
): Promise<ReviewResult> {
  const db = (await getDb()) as any;
  const { data: w } = await db
    .from('gm_withdrawals')
    .select('*')
    .eq('id', id)
    .eq('status', 'pending')
    .maybeSingle();
  if (!w) return { ok: false, message: 'Request not found or already processed' };

  // Reserve this request for the first admin who acts, preventing duplicate payouts.
  const { data: reserved } = await db
    .from('gm_withdrawals')
    .update({ status: 'processing' })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (!reserved) return { ok: false, message: 'Request is being processed or already completed' };

  const { notifyUser } = await import('@/lib/admin.server');

  if (action === 'reject') {
    const why = (reason ?? '').trim() || 'Rejected by an administrator';
    // Atomic refund (row-locked) so a concurrent balance change is not lost.
    await db.rpc('gm_add_balance', { _telegram_id: w.telegram_id, _amount: Number(w.amount) });
    await db
      .from('gm_withdrawals')
      .update({ status: 'rejected', rejection_reason: why, processed_at: new Date().toISOString() })
      .eq('id', id);
    if (w.channel_message_id) {
      const { markChannelWithdrawalRejected } = await import('@/lib/withdraw-notify.server');
      await markChannelWithdrawalRejected(
        {
          requestId: Number(id),
          telegramId: Number(w.telegram_id),
          amount: Number(w.amount),
          wallet: String(w.wallet_address),
        },
        Number(w.channel_message_id),
      );
    }
    await notifyUser(
      Number(w.telegram_id),
      `❌ <b>Withdrawal request rejected</b>\n\n💰 Amount: ${w.amount} GRAM\nReason: ${why}\n\n✅ The balance was returned to your account.`,
    );
    await announceReviewToAdmins({
      requestId: Number(id),
      action: 'reject',
      ok: true,
      message: `Reason: ${why}`,
      actorId: actor?.id ?? null,
      actorName: actor?.name ?? null,
      amount: Number(w.amount),
      telegramId: Number(w.telegram_id),
    });
    return { ok: true, message: 'Rejected and balance returned' };
  }

  let txHash: string | null = null;
  const { hasPayoutWallet } = await import('@/lib/ton.server');
  if (!(await hasPayoutWallet())) {
    await db.from('gm_withdrawals').update({ status: 'pending' }).eq('id', id);
    await announceReviewToAdmins({
      requestId: Number(id),
      action: 'approve',
      ok: false,
      message: 'Payout wallet is not configured; no funds were sent and the request is still under review.',
      actorId: actor?.id ?? null,
      actorName: actor?.name ?? null,
      amount: Number(w.amount),
      telegramId: Number(w.telegram_id),
    });
    return { ok: false, message: 'Payout wallet is not configured and no funds were sent' };
  }
  {
    const { sendTonPayout } = await import('@/lib/ton.server');
    // Send once only — a second attempt could pay twice if the
    // first transfer already reached the network.
    const result = await sendTonPayout(String(w.wallet_address), Number(w.amount));
    if (!result.ok) {
      await db
        .from('gm_withdrawals')
        .update({ status: 'pending', rejection_reason: `auto payout failed: ${result.error}` })
        .eq('id', id);
      await announceReviewToAdmins({
        requestId: Number(id),
        action: 'approve',
        ok: false,
        message: `On-chain transfer failed: ${result.error}\nThe request is still under review.`,
        actorId: actor?.id ?? null,
        actorName: actor?.name ?? null,
        amount: Number(w.amount),
        telegramId: Number(w.telegram_id),
      });
      return { ok: false, message: `On-chain transfer failed: ${result.error}` };
    }
    txHash = result.txHash;
  }

  await db
    .from('gm_withdrawals')
    .update({
      status: 'approved',
      tx_hash: txHash,
      rejection_reason: null,
      processed_at: new Date().toISOString(),
    })
    .eq('id', id);

  const { announceWithdrawal } = await import('@/lib/withdraw-notify.server');
  await announceWithdrawal({
    requestId: Number(id),
    telegramId: Number(w.telegram_id),
    amount: Number(w.amount),
    wallet: String(w.wallet_address),
    txHash,
    channelMessageId: w.channel_message_id ? Number(w.channel_message_id) : null,
  });
  await announceReviewToAdmins({
    requestId: Number(id),
    action: 'approve',
    ok: true,
    message: txHash ? `Sent on-chain.` : 'Approved.',
    actorId: actor?.id ?? null,
    actorName: actor?.name ?? null,
    amount: Number(w.amount),
    telegramId: Number(w.telegram_id),
  });
  return { ok: true, message: 'Approved and sent' };
}

/**
 * Recovers withdrawals whose payout attempt was interrupted mid-flight (the
 * server process was killed — e.g. because the user closed the withdraw
 * screen — while the request sat reserved in `processing`). Only rows older
 * than `staleMinutes` are touched: `sendTonPayout` normally resolves within
 * ~15s, so anything still `processing` well past that either never actually
 * reached the network (safe to hand back to the normal retry queue) or did
 * reach it (in which case it shows up on-chain and is recorded as approved).
 * Either way this never resends a transfer, so it can never double-pay.
 */
export async function recoverStaleWithdrawals(staleMinutes = 5) {
  const db = (await getDb()) as any;
  const cutoff = new Date(Date.now() - staleMinutes * 60_000).toISOString();
  const { data: stuck } = await db
    .from('gm_withdrawals')
    .select('id, telegram_id, wallet_address, amount, created_at')
    .eq('status', 'processing')
    .lt('created_at', cutoff);

  let recovered = 0;
  let requeued = 0;
  for (const w of (stuck ?? []) as {
    id: number;
    telegram_id: number;
    wallet_address: string;
    amount: number;
    created_at: string;
  }[]) {
    try {
      // Re-check status: another recovery pass or an admin action may have
      // already resolved it between the select above and now.
      const { data: reserved } = await db
        .from('gm_withdrawals')
        .update({ status: 'recovering' })
        .eq('id', w.id)
        .eq('status', 'processing')
        .select('id')
        .maybeSingle();
      if (!reserved) continue;

      const { findOutgoingPayout } = await import('@/lib/ton.server');
      const sinceUnix = Math.floor(new Date(w.created_at).getTime() / 1000);
      const found = await findOutgoingPayout(w.wallet_address, Number(w.amount), sinceUnix);

      if (found) {
        await db
          .from('gm_withdrawals')
          .update({
            status: 'approved',
            tx_hash: found.txHash,
            rejection_reason: null,
            processed_at: new Date().toISOString(),
          })
          .eq('id', w.id);
        const { announceWithdrawal } = await import('@/lib/withdraw-notify.server');
        await announceWithdrawal({
          requestId: Number(w.id),
          telegramId: Number(w.telegram_id),
          amount: Number(w.amount),
          wallet: String(w.wallet_address),
          txHash: found.txHash,
          channelMessageId: null,
        });
        await announceReviewToAdmins({
          requestId: Number(w.id),
          action: 'approve',
          ok: true,
          message: 'Recovered after an interrupted payout attempt: the transfer had already reached the network.',
          amount: Number(w.amount),
          telegramId: Number(w.telegram_id),
        });
        recovered += 1;
      } else {
        // Never actually sent — safe to hand back to the normal payout queue.
        await db
          .from('gm_withdrawals')
          .update({ status: 'pending', rejection_reason: null })
          .eq('id', w.id);
        await announceReviewToAdmins({
          requestId: Number(w.id),
          action: 'approve',
          ok: false,
          message: 'The previous payout attempt was interrupted before it reached the network. Requeued for automatic retry.',
          amount: Number(w.amount),
          telegramId: Number(w.telegram_id),
        });
        requeued += 1;
      }
    } catch (err) {
      console.error(`recoverStaleWithdrawals: failed to recover #${w.id}:`, err);
      // The lookup itself failed (e.g. toncenter hiccup) — release the
      // reservation back to 'processing' so the next scheduled run (created_at
      // is unchanged, so it's still past the cutoff) tries the recovery again.
      await db
        .from('gm_withdrawals')
        .update({ status: 'processing' })
        .eq('id', w.id)
        .eq('status', 'recovering');
    }
  }
  return { checked: (stuck ?? []).length, recovered, requeued };
}

function looksLikeInsufficientFunds(message: string): boolean {
  const m = String(message ?? '').toLowerCase();
  return (
    m.includes('too low') ||
    m.includes('insufficient') ||
    m.includes('not enough') ||
    m.includes('balance')
  );
}

/**
 * Pays out pending withdrawals oldest-first with whatever the payout wallet
 * currently holds. Requests that don't fit stay pending for the next run.
 */
export async function processPendingWithdrawals(limit = 25) {
  const { hasPayoutWallet } = await import('@/lib/ton.server');
  if (!(await hasPayoutWallet())) return { processed: 0, paid: 0, skipped: 0 };

  const db = (await getDb()) as any;
  const { data: pending } = await db
    .from('gm_withdrawals')
    .select('id, amount')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit);

  let paid = 0;
  let skipped = 0;
  for (const row of (pending ?? []) as { id: number; amount: number }[]) {
    const result = await reviewWithdrawal(Number(row.id), 'approve', undefined, {
      id: null,
      name: 'Auto payout (queue)',
    });
    if (result.ok) {
      paid += 1;
      continue;
    }
    skipped += 1;
    // Out of funds right now: leave the rest of the queue for a later run,
    // but keep trying smaller requests that might still fit.
    if (!looksLikeInsufficientFunds(result.message)) continue;
  }
  return { processed: (pending ?? []).length, paid, skipped };
}
