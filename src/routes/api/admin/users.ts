import { createFileRoute } from '@tanstack/react-router';
import { getAdminDb, getBotToken, json, mapUser, notifyUser, requireAdmin } from '@/lib/admin.server';

const fmt = (n: number) => (Math.round(n * 1_000_000) / 1_000_000).toString();

/** Tells the user their gram/coin balance changed (added, deducted or set). */
async function notifyBalanceChange(
  telegramId: number,
  kind: 'gram' | 'coin',
  mode: 'delta' | 'set',
  amount: number,
  newTotal: number,
) {
  const unit = kind === 'gram' ? 'gram' : 'coin';
  const head =
    mode === 'set'
      ? `🛠 <b>Your balance was adjusted</b>`
      : amount >= 0
        ? `✅ <b>Balance added to your account</b>`
        : `⚠️ <b>Balance deducted from your account</b>`;
  const line =
    mode === 'set'
      ? `New value: <b>${fmt(newTotal)} ${unit}</b>`
      : `${amount >= 0 ? 'Amount added' : 'Amount deducted'}: <b>${fmt(Math.abs(amount))} ${unit}</b>`;
  const lines = [head, '', line];
  if (mode !== 'set') lines.push(`Your current balance: <b>${fmt(newTotal)} ${unit}</b>`);
  await notifyUser(telegramId, lines.join('\n'));
}

/** Distinct accounts that were seen on the same IP addresses as each user. */
async function enrich(db: any, rows: any[]) {
  const users = rows.map(mapUser);
  if (!users.length) return users;
  const ids = users.map((u) => u.telegramId);

  const { data: refRows } = await db
    .from('gm_referrals')
    .select('referrer_id')
    .in('referrer_id', ids);
  const refCount = new Map<number, number>();
  for (const r of refRows ?? []) {
    const k = Number(r.referrer_id);
    refCount.set(k, (refCount.get(k) ?? 0) + 1);
  }

  const { data: ipRows } = await db.from('gm_user_ips').select('telegram_id, ip').in('telegram_id', ids);
  const ipsOf = new Map<number, string[]>();
  for (const r of ipRows ?? []) {
    const k = Number(r.telegram_id);
    ipsOf.set(k, [...(ipsOf.get(k) ?? []), String(r.ip)]);
  }
  const allIps = [...new Set((ipRows ?? []).map((r: any) => String(r.ip)))];
  const siblingsByIp = new Map<string, Set<number>>();
  if (allIps.length) {
    const { data: sib } = await db.from('gm_user_ips').select('telegram_id, ip').in('ip', allIps);
    for (const r of sib ?? []) {
      const ip = String(r.ip);
      if (!siblingsByIp.has(ip)) siblingsByIp.set(ip, new Set());
      siblingsByIp.get(ip)!.add(Number(r.telegram_id));
    }
  }

  return users.map((u) => {
    const ips = ipsOf.get(u.telegramId) ?? [];
    const siblings = new Set<number>();
    for (const ip of ips) for (const t of siblingsByIp.get(ip) ?? []) if (t !== u.telegramId) siblings.add(t);
    return {
      ...u,
      ips,
      referralCount: refCount.get(u.telegramId) ?? 0,
      ipSiblingCount: siblings.size,
      ipSiblings: [...siblings],
    };
  });
}

async function handle({ request }: { request: Request }): Promise<Response> {
  const guard = await requireAdmin(request);
  if (guard instanceof Response) return guard;

  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const idParam = url.searchParams.get('id');
  const id = idParam ? Number(idParam) : undefined;
  const method = request.method;
  const body =
    method === 'GET'
      ? {}
      : ((await request.json().catch(() => ({}))) as Record<string, any>);
  const db = (await getAdminDb()) as any;

  try {
    if (method === 'GET' && action === 'search') {
      const q = (url.searchParams.get('q') ?? '').trim();
      if (!q) return json({ error: 'q required' }, 400);
      if (/^\d+$/.test(q)) {
        const { data } = await db.from('gm_users').select('*').eq('telegram_id', Number(q)).limit(1);
        return json(await enrich(db, data ?? []));
      }
      const clean = q.replace(/^@/, '');
      const { data } = await db
        .from('gm_users')
        .select('*')
        .or(`username.ilike.${clean},first_name.ilike.%${clean}%`)
        .limit(20);
      return json(await enrich(db, data ?? []));
    }

    // Full account dossier for one Telegram ID.
    if (method === 'GET' && action === 'details' && id) {
      const { data } = await db.from('gm_users').select('*').eq('telegram_id', id).maybeSingle();
      if (!data) return json({ error: 'User not found' }, 404);
      const [main] = await enrich(db, [data]);
      const siblingIds = (main as any).ipSiblings as number[];
      let siblings: any[] = [];
      if (siblingIds.length) {
        const { data: s } = await db
          .from('gm_users')
          .select('*')
          .in('telegram_id', siblingIds)
          .limit(50);
        siblings = (s ?? []).map(mapUser);
      }
      const [{ count: withdrawals }, { count: deposits }, { count: tasksDone }] = await Promise.all([
        db.from('gm_withdrawals').select('id', { count: 'exact', head: true }).eq('telegram_id', id),
        db.from('gm_deposits').select('id', { count: 'exact', head: true }).eq('telegram_id', id),
        db.from('gm_task_completions').select('id', { count: 'exact', head: true }).eq('telegram_id', id),
      ]);
      return json({
        ...main,
        walletAddress: (data.wallet_address as string | null) ?? null,
        referredBy: data.referred_by ? Number(data.referred_by) : null,
        language: (data.language as string | null) ?? null,
        createdAt: data.created_at ?? null,
        lastActiveAt: data.last_active_at ?? null,
        blockedBot: Boolean(data.blocked_bot),
        withdrawalsCount: withdrawals ?? 0,
        depositsCount: deposits ?? 0,
        tasksCompleted: tasksDone ?? 0,
        siblings,
      });
    }

    if (method === 'POST' && action === 'ban' && id) {
      await db.from('gm_users').update({ is_banned: Boolean(body.ban) }).eq('telegram_id', id);
      return json({ ok: true });
    }

    // Ban (or unban) every account that shares an IP with this user, plus the user.
    if (method === 'POST' && action === 'ban_ip' && id) {
      const ban = body.ban === undefined ? true : Boolean(body.ban);
      const { data: mine } = await db.from('gm_user_ips').select('ip').eq('telegram_id', id);
      const ips = [...new Set((mine ?? []).map((r: any) => String(r.ip)))];
      const targets = new Set<number>([id]);
      if (ips.length) {
        const { data: sib } = await db.from('gm_user_ips').select('telegram_id').in('ip', ips);
        for (const r of sib ?? []) targets.add(Number(r.telegram_id));
      }
      await db.from('gm_users').update({ is_banned: ban }).in('telegram_id', [...targets]);
      return json({ ok: true, affected: targets.size });
    }

    if (method === 'POST' && action === 'restrict' && id) {
      await db
        .from('gm_users')
        .update({ restrict_withdrawal: Boolean(body.restrict) })
        .eq('telegram_id', id);
      return json({ ok: true });
    }

    if (method === 'POST' && action === 'balance' && id) {
      const raw = Number(body.amount);
      if (!Number.isFinite(raw)) return json({ error: 'Invalid amount' }, 400);
      const amount = Math.max(-1_000_000, Math.min(1_000_000, raw));
      const { data: u } = await db
        .from('gm_users')
        .select('balance')
        .eq('telegram_id', id)
        .maybeSingle();
      const next = Math.round((Number(u?.balance ?? 0) + amount) * 1_000_000) / 1_000_000;
      const { data } = await db
        .from('gm_users')
        .update({ balance: next })
        .eq('telegram_id', id)
        .select('balance')
        .maybeSingle();
      const balance = Number(data?.balance ?? next);
      if (amount !== 0) await notifyBalanceChange(id, 'gram', 'delta', amount, balance);
      return json({ ok: true, balance });
    }

    if (method === 'POST' && action === 'balance_set' && id) {
      const raw = Number(body.value);
      if (!Number.isFinite(raw) || raw < 0) return json({ error: 'value must be non-negative' }, 400);
      const value = Math.round(raw * 1_000_000) / 1_000_000;
      const { data } = await db
        .from('gm_users')
        .update({ balance: value })
        .eq('telegram_id', id)
        .select('balance')
        .maybeSingle();
      const balance = Number(data?.balance ?? value);
      await notifyBalanceChange(id, 'gram', 'set', value, balance);
      return json({ ok: true, balance });
    }

    if (method === 'POST' && action === 'coins' && id) {
      const raw = Number(body.amount);
      if (!Number.isFinite(raw)) return json({ error: 'Invalid amount' }, 400);
      const amount = Math.round(Math.max(-100_000_000, Math.min(100_000_000, raw)));
      const { data: u } = await db
        .from('gm_users')
        .select('coins')
        .eq('telegram_id', id)
        .maybeSingle();
      const next = Math.max(0, Math.round(Number(u?.coins ?? 0) + amount));
      const { data } = await db
        .from('gm_users')
        .update({ coins: next })
        .eq('telegram_id', id)
        .select('coins')
        .maybeSingle();
      const coins = Number(data?.coins ?? next);
      if (amount !== 0) await notifyBalanceChange(id, 'coin', 'delta', amount, coins);
      return json({ ok: true, coins });
    }

    if (method === 'POST' && action === 'coins_set' && id) {
      const raw = Number(body.value);
      if (!Number.isFinite(raw) || raw < 0) return json({ error: 'value must be non-negative' }, 400);
      const value = Math.round(raw);
      const { data } = await db
        .from('gm_users')
        .update({ coins: value })
        .eq('telegram_id', id)
        .select('coins')
        .maybeSingle();
      const coins = Number(data?.coins ?? value);
      await notifyBalanceChange(id, 'coin', 'set', value, coins);
      return json({ ok: true, coins });
    }

    if (method === 'POST' && action === 'warn' && id) {
      const token = getBotToken();
      if (!token) return json({ error: 'BOT_TOKEN not set' }, 503);
      const message = String(body.message ?? '').trim();
      if (!message) return json({ error: 'message required' }, 400);
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: id,
          text: `⚠️ <b>Warning from the admins</b>\n\n${message}`,
          parse_mode: 'HTML',
        }),
      });
      if (!r.ok) return json({ error: 'Telegram API error' }, 502);
      return json({ ok: true });
    }

    if (method === 'POST' && action === 'message' && id) {
      const token = getBotToken();
      if (!token) return json({ error: 'BOT_TOKEN not set' }, 503);
      const message = String(body.message ?? '').trim();
      if (!message) return json({ error: 'message required' }, 400);
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: id, text: message, parse_mode: 'HTML' }),
      });
      const data = (await r.json().catch(() => null)) as any;
      if (!r.ok || !data?.ok) {
        return json({ error: data?.description ?? 'Telegram API error' }, 502);
      }
      return json({ ok: true });
    }

    if (method === 'DELETE' && id) {
      await db.from('gm_task_completions').delete().eq('telegram_id', id);
      await db.from('gm_withdrawals').delete().eq('telegram_id', id).eq('status', 'pending');
      await db.from('gm_users').delete().eq('telegram_id', id);
      return json({ ok: true });
    }

    return json({ error: `Invalid action or missing id (action=${action}, id=${id})` }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: 'Internal server error' }, 500);
  }
}

export const Route = createFileRoute('/api/admin/users')({
  server: { handlers: { GET: handle, POST: handle, PATCH: handle, DELETE: handle } },
});