import { getAllAdminIds, getBotToken, getSetting, setSetting } from '@/lib/admin.server';
import { computeAccrued, getDb, getWelcomeMessage, upsertUser } from '@/lib/telegram-user.server';

type TgUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

export type TgUpdate = {
  message?: {
    chat?: { id?: number };
    from?: TgUser;
    text?: string;
    caption?: string;
    message_id?: number;
  };
  callback_query?: {
    id: string;
    from?: TgUser;
    data?: string;
    message?: { chat?: { id?: number }; message_id?: number };
  };
};

type Kb = { inline_keyboard: Array<Array<Record<string, unknown>>> };

/**
 * Button styles understood by modified Telegram clients (Telegraph, etc.):
 * success = green, danger = red, primary = theme color. Official clients
 * ignore the extra field, so we keep a stripped fallback below.
 */
type BtnStyle = 'success' | 'danger' | 'primary';

const btn = (
  text: string,
  action: Record<string, unknown>,
  style?: BtnStyle,
): Record<string, unknown> => ({ text, ...action, ...(style ? { style } : {}) });

/** Removes non-standard button fields for clients that reject them. */
function stripStyle(kb?: Kb): { kb?: Kb; changed: boolean } {
  if (!kb) return { kb, changed: false };
  let changed = false;
  const inline_keyboard = kb.inline_keyboard.map((row) =>
    row.map((b) => {
      if (!('style' in b) && !('icon_custom_emoji_id' in b)) return b;
      changed = true;
      const { style: _style, icon_custom_emoji_id: _icon, ...rest } = b;
      return rest;
    }),
  );
  return { kb: { inline_keyboard }, changed };
}

function webAppUrl(): string {
  return (
    process.env.WEBAPP_URL ??
    'https://gram-mnx.lovable.app'
  );
}

async function api(method: string, body: Record<string, unknown>) {
  const token = getBotToken();
  if (!token) return { ok: false as const, error: 'no token' };
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
  if (!res.ok || !data?.ok) {
    console.error(`Telegram ${method} failed [${res.status}]: ${data?.description ?? 'unknown'}`);
    return { ok: false as const, error: data?.description ?? String(res.status) };
  }
  return { ok: true as const };
}

/** Replaces <tg-emoji ...>X</tg-emoji> with the plain fallback emoji X. */
function stripCustomEmoji(text: string): string {
  return text.replace(/<tg-emoji[^>]*>(.*?)<\/tg-emoji>/gs, '$1');
}

async function send(chat_id: number, text: string, reply_markup?: Kb) {
  const res = await api('sendMessage', { chat_id, text, parse_mode: 'HTML', reply_markup });
  if (res.ok) return res;
  const { kb, changed } = stripStyle(reply_markup);
  if (changed) {
    const retry = await api('sendMessage', { chat_id, text, parse_mode: 'HTML', reply_markup: kb });
    if (retry.ok) return retry;
  }
  // Custom (premium) emoji can be rejected — retry without them so the message always arrives.
  const plain = stripCustomEmoji(text);
  if (plain !== text) {
    const retry = await api('sendMessage', {
      chat_id,
      text: plain,
      parse_mode: 'HTML',
      reply_markup: kb ?? reply_markup,
    });
    if (retry.ok) return retry;
  }
  return api('sendMessage', { chat_id, text: stripCustomEmoji(text).replace(/<[^>]+>/g, '') });
}

async function edit(chat_id: number, message_id: number, text: string, reply_markup?: Kb) {
  const res = await api('editMessageText', {
    chat_id,
    message_id,
    text,
    parse_mode: 'HTML',
    reply_markup,
  });
  if (res.ok) return res;
  const { kb, changed } = stripStyle(reply_markup);
  if (!changed) return res;
  return api('editMessageText', { chat_id, message_id, text, parse_mode: 'HTML', reply_markup: kb });
}

const isAdmin = async (id: number) => (await getAllAdminIds()).includes(id);
const stateKey = (id: number) => `bot_state_${id}`;

const num = (v: unknown) => Number(v ?? 0);
const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 4 });

/* ------------------------------- user side ------------------------------- */

type GateChannel = { username: string; name: string };

/** Channels the user must join before using the app (force-join). */
async function missingChannels(userId: number): Promise<GateChannel[]> {
  const db = await getDb();
  const { data } = await db.from('gm_channels').select('channel_username, channel_name');
  const token = getBotToken();
  const list = (data ?? []) as Array<{ channel_username: string; channel_name?: string | null }>;
  if (!token || list.length === 0) return [];
  const missing: GateChannel[] = [];
  for (const c of list) {
    const username = c.channel_username.replace(/^@/, '');
    const res = await fetch(
      `https://api.telegram.org/bot${token}/getChatMember?chat_id=@${username}&user_id=${userId}`,
    );
    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; result?: { status?: string } }
      | null;
    const status = body?.result?.status;
    if (!body?.ok || !status || ['left', 'kicked'].includes(status)) {
      missing.push({ username, name: (c.channel_name || '').trim() || `@${username}` });
    }
  }
  return missing;
}

/** Blue channel buttons + a single green "verify" button. */
function gateKeyboard(missing: GateChannel[], lang: 'ar' | 'en'): Kb {
  return {
    inline_keyboard: [
      ...missing.map((c) => [
        btn(`${c.name}`, { url: `https://t.me/${c.username}` }, 'primary'),
      ]),
      [
        btn(
          lang === 'ar' ? 'تحقق الآن' : 'Verify now',
          { callback_data: 'gate:check' },
          'success',
        ),
      ],
    ],
  };
}

function gateText(lang: 'ar' | 'en'): string {
  return lang === 'ar'
    ? '⚠️ Join the following channels first\n\nTap each channel to join, then press “Verify now”.'
    : '⚠️ Please join these channels first\n\nTap each channel to join, then press "Verify now".';
}

/** Sends the welcome message with the Open GRAM MNX button. */
async function sendWelcome(chatId: number, from: TgUser, lang: 'ar' | 'en', path = '') {
  const welcome = await getWelcomeMessage(from.first_name ?? '', lang);
  const label = 'Open GRAM MNX';
  const url = `${webAppUrl().replace(/\/$/, '')}${path}`;
  const startBtn = (action: Record<string, unknown>): Record<string, unknown> => ({
    text: label,
    icon_custom_emoji_id: '5852921662776809366',
    ...action,
    style: 'success',
  });
  const res = await send(chatId, welcome, {
    inline_keyboard: [[startBtn({ web_app: { url } })]],
  });

  if (!res.ok) {
    // Some clients reject web_app buttons — fall back to a plain URL button.
    await send(chatId, welcome, {
      inline_keyboard: [[startBtn({ url: webAppUrl() })]],
    });
  }
}

/** The bot always speaks English. */
function botLang(): 'ar' | 'en' {
  return 'en';
}

/** Tells the inviter right away that a new invite landed (still pending). */
async function notifyNewInvite(referrerId: number, invitedName: string) {
  try {
    const db = await getDb();
    const [{ count: confirmed }, { count: pending }] = await Promise.all([
      db
        .from('gm_referrals')
        .select('id', { count: 'exact', head: true })
        .eq('referrer_id', referrerId)
        .eq('reward_paid', true),
      db
        .from('gm_referrals')
        .select('id', { count: 'exact', head: true })
        .eq('referrer_id', referrerId)
        .eq('reward_paid', false),
    ]);

    await send(
      referrerId,
      [
        `<tg-emoji emoji-id="5258513401784573443">👥</tg-emoji> ${invitedName} joined with your link`,
        '',
        `<tg-emoji emoji-id="5231200819986047254">📊</tg-emoji> Confirmed referrals: ${confirmed ?? 0}`,
        `<tg-emoji emoji-id="5451732530048802485">⏳</tg-emoji> Pending referrals: ${pending ?? 0}`,
      ].join('\n'),
    );
  } catch (err) {
    console.error('notifyNewInvite failed:', err);
  }
}

async function handleStart(chatId: number, from: TgUser, text: string, isNewUser?: boolean) {
  const { userExists } = await import('@/lib/telegram-user.server');
  // `isNewUser` is measured BEFORE any row is created for this update; falling
  // back to a live lookup only happens for direct calls.
  const alreadyKnown = isNewUser === undefined ? await userExists(from.id) : !isNewUser;


  await upsertUser({
    id: from.id,
    first_name: from.first_name,
    last_name: from.last_name,
    username: from.username,
  });

  // English is the bot's default language for every notification.
  const lang = botLang();

  // Referral payload: /start <id> or /start ref_<id>
  const payload = text.split(/\s+/)[1] ?? '';

  // Gift giveaway link (g_<id>): count the invite and open the gift page.
  const { parseGiftRef, recordGiftInvite } = await import('@/lib/gift.server');
  const giftRef = parseGiftRef(payload);
  if (giftRef) {
    await recordGiftInvite(
      from.id,
      giftRef,
      from.username ? `@${from.username}` : (from.first_name ?? null),
    ).catch(() => false);
    await sendWelcome(chatId, from, botLang(), '/gift');
    return;
  }

  const referrerId = Number(payload.replace(/^ref_?/i, ''));

  if (Number.isFinite(referrerId) && referrerId > 0 && referrerId !== from.id) {
    const { registerReferral, creditReferralIfEligible } = await import('@/lib/referral.server');
    // Only a first-ever contact counts; anyone who already used the bot can
    // never be attributed to an inviter afterwards.
    const created = await registerReferral(from.id, referrerId, { isNewUser: !alreadyKnown });
    if (created) {
      await notifyNewInvite(referrerId, from.first_name ?? 'A new friend');
    }
    await creditReferralIfEligible(from.id);
  }


  // Maintenance gate: blocks regular users only, admins can still use the bot
  // so they can turn maintenance off again.
  if ((await getSetting('maintenance_mode')) === 'true' && !(await isAdmin(from.id))) {
    const msg =
      (await getSetting('maintenance_message')) ||
      '🔧 The bot is under maintenance, please try again later.';
    await send(chatId, msg);
    return;
  }


  const missing = await missingChannels(from.id);
  if (missing.length > 0) {
    await send(chatId, gateText(lang), gateKeyboard(missing, lang));
    return;
  }

  await sendWelcome(chatId, from, lang);
}

async function handleBalance(chatId: number, from: TgUser) {
  const db = await getDb();
  const { data } = await db
    .from('gm_users')
    .select('balance, coins')
    .eq('telegram_id', from.id)
    .maybeSingle();
  const accrued = await computeAccrued(from.id);
  const ar = false;
  const row = (data ?? {}) as { balance?: number; coins?: number };
  await send(
    chatId,
    ar
      ? `💰 <b>رصيدك في GRAM MNX</b>\n\n💎 gram: <b>${fmt(num(row.balance))}</b>\n🪙 coins: <b>${fmt(num(row.coins))}</b>\n⛏️ قيد التعدين: <b>${fmt(accrued.accrued)}</b>`
      : `💰 <b>Your GRAM MNX balance</b>\n\n💎 gram: <b>${fmt(num(row.balance))}</b>\n🪙 coins: <b>${fmt(num(row.coins))}</b>\n⛏️ Mining now: <b>${fmt(accrued.accrued)}</b>`,
    { inline_keyboard: [[btn('⛏️ GRAM MNX', { web_app: { url: webAppUrl() } }, 'success')]] },
  );
}

/* ------------------------------- admin side ------------------------------ */

const adminMenu: Kb = {
  inline_keyboard: [
    [
      btn('📊 Stats', { callback_data: 'admin:stats' }, 'primary'),
      btn('✏️ Welcome message', { callback_data: 'admin:welcome' }, 'primary'),
    ],
    [
      btn('📨 Broadcast', { callback_data: 'admin:broadcast' }, 'primary'),
      btn('👤 Find user', { callback_data: 'admin:users' }, 'primary'),
    ],
    [
      btn('💸 Min withdraw', { callback_data: 'admin:withdraw_min' }, 'primary'),
      btn('💰 Min deposit', { callback_data: 'admin:deposit_min' }, 'primary'),
    ],
    [
      btn('🔗 Referral reward', { callback_data: 'admin:ref_price' }, 'primary'),
      btn('🔧 Maintenance mode', { callback_data: 'admin:maintenance' }, 'danger'),
    ],
  ],
};

const backKb = (cb = 'admin:back'): Kb => ({
  inline_keyboard: [[btn('« Back', { callback_data: cb }, 'primary')]],
});

async function statsText(): Promise<string> {
  const db = await getDb();
  const anyDb = db as unknown as { from: (t: string) => any };
  const count = async (table: string, filter?: (q: any) => any) => {
    let q = anyDb.from(table).select('*', { count: 'exact', head: true });
    if (filter) q = filter(q);
    const { count: c } = await q;
    return c ?? 0;
  };
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const [users, active, banned, refs, withdrawals, pending] = await Promise.all([
    count('gm_users'),
    count('gm_users', (q: any) => q.gte('last_active_at', dayAgo)),
    count('gm_users', (q: any) => q.eq('is_banned', true)),
    count('gm_referrals'),
    count('gm_withdrawals'),
    count('gm_withdrawals', (q: any) => q.eq('status', 'pending')),
  ]);
  return [
    '📊 <b>GRAM MNX stats</b>',
    '',
    `👥 Users: <b>${users}</b>`,
    `🟢 Active (24h): <b>${active}</b>`,
    `🚫 Banned: <b>${banned}</b>`,
    `🔗 Referrals: <b>${refs}</b>`,
    `💸 Withdrawals: <b>${withdrawals}</b> (pending: <b>${pending}</b>)`,
  ].join('\n');
}

async function userCard(chatId: number, target: number) {
  const db = await getDb();
  const { data } = await db
    .from('gm_users')
    .select('telegram_id, username, first_name, balance, coins, is_banned, restrict_withdrawal')
    .eq('telegram_id', target)
    .maybeSingle();
  if (!data) {
    await send(chatId, '❌ User not found.', backKb());
    return;
  }
  const u = data as Record<string, unknown>;
  const text = [
    `👤 <b>${(u.first_name as string) ?? '—'}</b> ${u.username ? `(@${u.username})` : ''}`,
    `🆔 <code>${u.telegram_id}</code>`,
    `💎 gram: <b>${fmt(num(u.balance))}</b>`,
    `🪙 coins: <b>${fmt(num(u.coins))}</b>`,
    `🚫 Banned: <b>${u.is_banned ? 'Yes' : 'No'}</b>`,
    `🔒 Withdrawals blocked: <b>${u.restrict_withdrawal ? 'Yes' : 'No'}</b>`,
  ].join('\n');
  await send(chatId, text, {
    inline_keyboard: [
      [
        u.is_banned
          ? btn('✅ Unban', { callback_data: `admin:u:unban:${target}` }, 'success')
          : btn('🚫 Ban', { callback_data: `admin:u:ban:${target}` }, 'danger'),
        u.restrict_withdrawal
          ? btn('✅ Allow withdrawals', { callback_data: `admin:u:unrestrict:${target}` }, 'success')
          : btn('🔒 Block withdrawals', { callback_data: `admin:u:restrict:${target}` }, 'danger'),
      ],
      [btn('« Back', { callback_data: 'admin:back' }, 'primary')],
    ],
  });
}

/**
 * Broadcasts the admin's own message. When `sourceMessageId` is provided the
 * message is copied as-is, which keeps premium (custom) emoji and formatting
 * exactly like the admin typed them in the bot chat.
 */
async function broadcast(fromChat: number, text: string, sourceMessageId?: number) {
  const db = await getDb();
  // Users who already blocked the bot are skipped: retrying them wastes the
  // whole time budget and can starve the users who can actually receive it.
  const { data } = await db
    .from('gm_users')
    .select('telegram_id')
    .eq('is_banned', false)
    .or('blocked_bot.is.null,blocked_bot.eq.false');
  const ids = ((data ?? []) as Array<{ telegram_id: number }>).map((r) => r.telegram_id);

  const deliver = async (id: number) =>
    sourceMessageId
      ? api('copyMessage', { chat_id: id, from_chat_id: fromChat, message_id: sourceMessageId })
      : send(id, text);

  let sent = 0;
  const blocked: number[] = [];
  const CHUNK = 25;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const results = await Promise.all(slice.map((id) => deliver(id).catch(() => ({ ok: false }))));
    results.forEach((res, idx) => {
      if (res.ok) sent += 1;
      else blocked.push(slice[idx]);
    });
  }
  if (blocked.length) {
    await db.from('gm_users').update({ blocked_bot: true }).in('telegram_id', blocked);
  }
  await send(fromChat, `✅ Sent to <b>${sent}</b> of ${ids.length} users.`, adminMenu);
}


/** Handles free-text replies while an admin action is pending. */
async function handleAdminState(
  chatId: number,
  adminId: number,
  text: string,
  messageId?: number,
): Promise<boolean> {
  const state = await getSetting(stateKey(adminId));
  if (!state) return false;
  // Only broadcast/private-message can be media-only; other states need text.
  const isDm = state.startsWith('dm:');
  if (!text && state !== 'broadcast' && !isDm) return false;
  await setSetting(stateKey(adminId), '');

  if (state === 'welcome') {
    await setSetting('welcome_message', text);
    await send(chatId, '✅ Welcome message updated.', adminMenu);
    return true;
  }
  if (isDm) {
    const target = Number(state.slice(3));
    const res = messageId
      ? await api('copyMessage', {
          chat_id: target,
          from_chat_id: chatId,
          message_id: messageId,
        }).catch(() => ({ ok: false }))
      : await send(target, text).catch(() => ({ ok: false }));
    await send(
      chatId,
      (res as { ok?: boolean })?.ok
        ? `✅ Message delivered to <code>${target}</code>.`
        : `❌ Could not deliver the message to <code>${target}</code>.`,
      adminMenu,
    );
    return true;
  }
  if (state === 'broadcast') {
    await send(chatId, '⏳ Sending…');
    await broadcast(chatId, text, messageId);
    return true;
  }

  if (state === 'users') {
    const target = Number(text.replace(/\D/g, ''));
    if (!target) await send(chatId, '❌ Enter a valid Telegram ID.', adminMenu);
    else await userCard(chatId, target);
    return true;
  }
  const numericKeys: Record<string, string> = {
    withdraw_min: 'min_withdrawal',
    deposit_min: 'min_deposit',
    ref_price: 'referral_reward',
  };
  const key = numericKeys[state];
  if (key) {
    const value = Number(text.replace(',', '.'));
    if (!Number.isFinite(value) || value < 0) {
      await send(chatId, '❌ Enter a valid number.', adminMenu);
      return true;
    }
    await setSetting(key, String(value));
    await send(chatId, `✅ Saved: <b>${value}</b>`, adminMenu);
    return true;
  }
  return false;
}

async function handleCallback(update: NonNullable<TgUpdate['callback_query']>) {
  const from = update.from;
  const chatId = update.message?.chat?.id;
  const messageId = update.message?.message_id;

  // Force-join verification — available to every user, not only admins.
  if ((update.data ?? '') === 'gate:check' && from?.id && chatId && messageId) {
    const lang = botLang();
    const missing = await missingChannels(from.id);
    if (missing.length === 0) {
      await api('answerCallbackQuery', {
        callback_query_id: update.id,
        text: '✅ Verified',
      });
      await edit(chatId, messageId, '✅ <b>All channels verified</b>');
      await sendWelcome(chatId, from, lang);
      return;
    }
    const names = missing.map((c) => `@${c.username}`).join('\n');
    await api('answerCallbackQuery', {
      callback_query_id: update.id,
      show_alert: true,
      text: `❌ You still need to join:\n${names}`,
    });
    await edit(chatId, messageId, gateText(lang), gateKeyboard(missing, lang));
    return;
  }

  await api('answerCallbackQuery', { callback_query_id: update.id });
  if (!from?.id || !chatId || !messageId || !(await isAdmin(from.id))) return;

  const data = update.data ?? '';

  // Withdrawal review straight from the chat notification.
  const wd = /^wd:(approve|reject):(\d+)$/.exec(data);
  if (wd) {
    const { reviewWithdrawal } = await import('@/lib/withdraw-review.server');
    const result = await reviewWithdrawal(
      Number(wd[2]),
      wd[1] as 'approve' | 'reject',
      wd[1] === 'reject' ? 'Rejected by an administrator' : undefined,
      {
        id: from.id,
        name: from.username ? `@${from.username}` : (from.first_name ?? null),
      },
    );
    await edit(
      chatId,
      messageId,
      `${result.ok ? '✅' : '❌'} Withdrawal #${wd[2]} — ${result.message}`,
    );
    return;
  }

  const prompts: Record<string, string> = {
    'admin:welcome': '✏️ Send the new welcome message text (HTML and {first_name} supported):',
    'admin:broadcast':
      '📨 Send the message you want to broadcast to all users (premium emoji is supported and will be delivered as-is):',
    'admin:users': '👤 Send the user\'s Telegram ID:',
    'admin:withdraw_min': '💸 Send the minimum withdrawal amount:',
    'admin:deposit_min': '💰 Send the minimum deposit amount:',
    'admin:ref_price': '🔗 Send the referral reward:',
  };

  if (data === 'admin:back') {
    await edit(chatId, messageId, '🛠 <b>GRAM MNX admin panel</b>', adminMenu);
    return;
  }
  if (data === 'admin:stats') {
    await edit(chatId, messageId, await statsText(), backKb());
    return;
  }
  if (data === 'admin:maintenance') {
    const on = (await getSetting('maintenance_mode')) === 'true';
    await setSetting('maintenance_mode', on ? 'false' : 'true');
    await edit(
      chatId,
      messageId,
      `🔧 Maintenance mode: <b>${on ? 'Off' : 'On'}</b>`,
      backKb(),
    );
    return;
  }
  if (prompts[data]) {
    await setSetting(stateKey(from.id), data.replace('admin:', ''));
    await edit(chatId, messageId, prompts[data], backKb());
    return;
  }
  const m = /^admin:u:(ban|unban|restrict|unrestrict):(\d+)$/.exec(data);
  if (m) {
    const db = await getDb();
    const target = Number(m[2]);
    const patch =
      m[1] === 'ban'
        ? { is_banned: true }
        : m[1] === 'unban'
          ? { is_banned: false }
          : m[1] === 'restrict'
            ? { restrict_withdrawal: true }
            : { restrict_withdrawal: false };
    await db.from('gm_users').update(patch).eq('telegram_id', target);
    await edit(chatId, messageId, '✅ Action completed.', backKb());
  }
}

/** Records/refreshes the user row so admin stats stay accurate. */
async function trackUser(from: TgUser | undefined) {
  if (!from?.id) return;
  try {
    await upsertUser({
      id: from.id,
      first_name: from.first_name,
      last_name: from.last_name,
      username: from.username,
    });
    const db = await getDb();
    await db
      .from('gm_users')
      .update({ last_active_at: new Date().toISOString(), blocked_bot: false })
      .eq('telegram_id', from.id);
  } catch (err) {
    console.error('[bot] trackUser failed:', err);
  }
}

/** Single entry point for every Telegram update; all state lives in the DB. */
export async function handleUpdate(update: TgUpdate) {
  if (update.callback_query) {
    await trackUser(update.callback_query.from);
    await handleCallback(update.callback_query);
    return;
  }

  const msg = update.message;
  const from = msg?.from;
  const chatId = msg?.chat?.id;
  if (!msg || !from?.id || !chatId) return;

  // Captions count too, so an admin can broadcast a photo/sticker message.
  const text = (msg.text ?? msg.caption ?? '').trim();

  // Must be checked BEFORE trackUser(), which creates the user row and would
  // otherwise make every first-ever /start look like a returning user.
  let isNewUser: boolean | undefined;
  if (text.startsWith('/start')) {
    const { userExists } = await import('@/lib/telegram-user.server');
    isNewUser = !(await userExists(from.id));
  }

  await trackUser(from);

  // Deep link from the admin panel: open the bot chat ready to type a
  // broadcast with premium emoji.
  if (text === '/start broadcast' && (await isAdmin(from.id))) {
    await setSetting(stateKey(from.id), 'broadcast');
    await send(
      chatId,
      '📨 Now type the message you want to broadcast to all users.\nYou can use your premium emoji and it will be delivered as-is.',
    );
    return;
  }

  // Deep link: send a private message (with premium emoji) to one user only.
  const dmMatch = /^\/start\s+dm_(\d+)$/.exec(text);
  if (dmMatch && (await isAdmin(from.id))) {
    const target = Number(dmMatch[1]);
    await setSetting(stateKey(from.id), `dm:${target}`);
    await send(
      chatId,
      `📩 Now type the private message for user <code>${target}</code>.\nYour premium emoji will be delivered as-is.`,
    );
    return;
  }


  if (text.startsWith('/start')) {
    await handleStart(chatId, from, text, isNewUser);
    return;
  }

  if (text === '/balance') {
    await handleBalance(chatId, from);
    return;
  }
  if (text === '/admin') {
    if (!(await isAdmin(from.id))) {
      await send(chatId, '⛔ This command is for admins only.');
      return;
    }
    await send(chatId, '🛠 <b>GRAM MNX admin panel</b>', adminMenu);
    return;
  }
  if ((await isAdmin(from.id)) && !text.startsWith('/')) {
    const handled = await handleAdminState(chatId, from.id, text, msg.message_id);
    if (handled) return;
  }
  if (text === '/help') {
    await send(
      chatId,
      '⛏️ <b>GRAM MNX</b>\n\n/start — open the app\n/balance — your balance\n/help — help',
    );
  }
}