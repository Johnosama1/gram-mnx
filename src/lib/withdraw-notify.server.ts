import { getAllAdminIds, getBotToken, getSetting, notifyUser } from '@/lib/admin.server';
import { getDb } from '@/lib/telegram-user.server';

const DEFAULT_CHANNEL = '@GramMNX1';

const E = {
  check: '<tg-emoji emoji-id="5929471698117070260">☑️</tg-emoji>',
  user: '<tg-emoji emoji-id="5260399854500191689">👤</tg-emoji>',
  id: '<tg-emoji emoji-id="5422683699130933153">🪪</tg-emoji>',
  gem: '<tg-emoji emoji-id="5945101187186433635">💎</tg-emoji>',
  wallet: '<tg-emoji emoji-id="5039557485157942342">👛</tg-emoji>',
  link: '<tg-emoji emoji-id="5271604874419647061">🔗</tg-emoji>',
};

export type WithdrawInfo = {
  requestId: number | null;
  telegramId: number;
  username?: string | null;
  amount: number;
  wallet: string;
  txHash?: string | null;
};

const fmtAmount = (n: number) => `${Number(n)} gram`;

function userTag(info: WithdrawInfo) {
  return info.username ? `@${String(info.username).replace(/^@/, '')}` : String(info.telegramId);
}

function bodyLines(info: WithdrawInfo) {
  const lines = [
    `${E.user} ${userTag(info)}`,
    `${E.id} <code>${info.telegramId}</code>`,
    `${E.gem} ${fmtAmount(info.amount)}`,
    `${E.wallet} <code>${info.wallet}</code>`,
  ];
  // Always show a blockchain link: the exact transaction when we have its hash,
  // otherwise the destination wallet page (where the payout shows up).
  const url = info.txHash
    ? `https://tonviewer.com/transaction/${encodeURIComponent(info.txHash)}`
    : `https://tonviewer.com/${encodeURIComponent(info.wallet)}`;
  lines.push(`${E.link} <a href="${url}">View transaction on blockchain</a>`);
  return lines.join('\n');
}

export function buildChannelMessage(info: WithdrawInfo, status: 'pending' | 'success' = 'success') {
  const head = status === 'pending' ? `⏳ #${info.requestId ?? '-'}` : `${E.check} #${info.requestId ?? '-'}`;
  return `${head}\n\n${bodyLines(info)}`;
}

export function buildDirectMessage(info: WithdrawInfo) {
  return bodyLines(info);
}

/** Strips premium custom-emoji wrappers, keeping the fallback unicode emoji. */
function stripPremiumEmoji(text: string) {
  return text.replace(/<tg-emoji[^>]*>(.*?)<\/tg-emoji>/g, '$1');
}

async function api<T = any>(method: string, payload: Record<string, unknown>): Promise<T | null> {
  const token = getBotToken();
  if (!token) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as any;
    if (!data?.ok) {
      console.error(`telegram ${method} failed:`, data?.description ?? res.status);
      return null;
    }
    return data.result as T;
  } catch (err) {
    console.error(`telegram ${method} error:`, err);
    return null;
  }
}

/** Sends HTML text, retrying without premium emoji if Telegram rejects them. */
async function send(chatId: string | number, text: string) {
  const result = await api<{ message_id: number }>('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
  });
  if (result) return result;
  return api<{ message_id: number }>('sendMessage', {
    chat_id: chatId,
    text: stripPremiumEmoji(text),
    parse_mode: 'HTML',
  });
}



async function resolveUsername(info: WithdrawInfo): Promise<WithdrawInfo> {
  if (info.username) return info;
  try {
    const db = (await getDb()) as any;
    const { data } = await db
      .from('gm_users')
      .select('username')
      .eq('telegram_id', info.telegramId)
      .maybeSingle();
    return { ...info, username: data?.username ?? null };
  } catch {
    return info;
  }
}

async function getChannel() {
  return (await getSetting('withdraw_channel')) || DEFAULT_CHANNEL;
}

/**
 * Posts the withdrawal to the channel as plain text in "pending" state.
 * Returns the posted message id so it can be edited later.
 */
export async function postPendingWithdrawal(input: WithdrawInfo): Promise<number | null> {
  try {
    const info = await resolveUsername(input);
    const channel = await getChannel();
    const sent = await send(channel, buildChannelMessage(info, 'pending'));
    return sent?.message_id ?? null;
  } catch (err) {
    console.error('postPendingWithdrawal failed:', err);
    return null;
  }
}

/** Posts/updates the payout in the public channel and messages the user + admins. */
export async function announceWithdrawal(
  input: Omit<WithdrawInfo, 'username'> & { username?: string | null; channelMessageId?: number | null },
) {
  try {
    const info = await resolveUsername(input as WithdrawInfo);
    const channel = await getChannel();
    const text = buildChannelMessage(info, 'success');
    const messageId = input.channelMessageId ?? null;

    let edited = false;
    if (messageId) {
      const okText = await api('editMessageText', {
        chat_id: channel,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
      });
      if (okText) edited = true;
      else {
        const okCaption = await api('editMessageCaption', {
          chat_id: channel,
          message_id: messageId,
          caption: text,
          parse_mode: 'HTML',
        });
        if (okCaption) edited = true;
      }
    }
    if (!edited) await send(channel, text);


    const direct = buildDirectMessage(info);
    await notifyUser(info.telegramId, direct);
    for (const adminId of await getAllAdminIds()) {
      if (adminId === info.telegramId) continue;
      await send(adminId, direct);
    }
  } catch (err) {
    console.error('announceWithdrawal failed:', err);
  }
}

/** Edits an existing pending channel post to the rejected state. */
export async function markChannelWithdrawalRejected(info: WithdrawInfo, messageId: number) {
  try {
    const full = await resolveUsername(info);
    const channel = await getChannel();
    const text = `❌ #${full.requestId ?? '-'}\n\n${bodyLines(full)}\n\n❌ <b>Rejected</b>`;
    const ok = await api('editMessageCaption', {
      chat_id: channel,
      message_id: messageId,
      caption: text,
      parse_mode: 'HTML',
    });
    if (!ok) {
      await api('editMessageText', {
        chat_id: channel,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
      });
    }
  } catch (err) {
    console.error('markChannelWithdrawalRejected failed:', err);
  }
}
