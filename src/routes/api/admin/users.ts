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

  // Independent of each other — both only need `ids`.
  const [{ data: refRows }, { data: ipRows }] = await Promise.all([
    db.from('gm_referrals').select('referrer_id').in('referrer_id', ids),
    db.from('gm_user_ips').select('telegram_id, ip').in('telegram_id', ids),
  ]);
  const refCount = new Map<number, number>();
  for (const r of refRows ?? []) {
    const k = Number(r.referrer_id);
    refCount.set(k, (refCount.get(k) ?? 0) + 1);
  }

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

    // Manual override for the withdrawal-unlock gate — lets an admin open
    // (or re-lock) withdrawals for one user regardless of deposit history.
    if (method === 'POST' && action === 'withdraw_gate' && id) {
      const { error } = await db
        .from('gm_users')
        .update({ withdrawal_unlocked: Boolean(body.unlocked) })
        .eq('telegram_id', id);
      if (error) {
        console.error('[admin] failed to update withdrawal_unlocked', error);
        return json({ error: 'Update failed' }, 500);
      }
      return json({ ok: true });
    }

    // Top 100 users by current balance, with deposit/withdrawal totals and
    // last-activity timestamps folded in for the admin panel's "Top Users"
    // section. Deposit/withdrawal rows for just these 100 ids are fetched
    // and aggregated here (sum + max) rather than via a DB-side GROUP BY,
    // matching how enrich() above already aggregates IP/referral data —
    // no new RPC needed, and it's an admin-only, infrequently-run report,
    // not a hot path.
    if (method === 'GET' && action === 'top') {
      const { data: topRows } = await db
        .from('gm_users')
        .select('telegram_id, username, first_name, last_name, balance')
        .order('balance', { ascending: false })
        .limit(100);
      const rows = (topRows ?? []) as any[];
      const ids = rows.map((r) => Number(r.telegram_id));
      if (!ids.length) return json([]);

      const [{ data: deposits }, { data: withdrawals }] = await Promise.all([
        db
          .from('gm_deposits')
          .select('telegram_id, amount, credited_at')
          .eq('status', 'confirmed')
          .in('telegram_id', ids),
        db
          .from('gm_withdrawals')
          .select('telegram_id, amount, processed_at')
          .eq('status', 'approved')
          .in('telegram_id', ids),
      ]);

      type Stat = { total: number; last: string | null };
      const depositStats = new Map<number, Stat>();
      for (const d of (deposits ?? []) as any[]) {
        const tid = Number(d.telegram_id);
        const cur = depositStats.get(tid) ?? { total: 0, last: null };
        cur.total += Number(d.amount ?? 0);
        if (d.credited_at && (!cur.last || d.credited_at > cur.last)) cur.last = d.credited_at;
        depositStats.set(tid, cur);
      }
      const withdrawStats = new Map<number, Stat>();
      for (const w of (withdrawals ?? []) as any[]) {
        const tid = Number(w.telegram_id);
        const cur = withdrawStats.get(tid) ?? { total: 0, last: null };
        cur.total += Number(w.amount ?? 0);
        if (w.processed_at && (!cur.last || w.processed_at > cur.last)) cur.last = w.processed_at;
        withdrawStats.set(tid, cur);
      }

      return json(
        rows.map((r) => {
          const tid = Number(r.telegram_id);
          const dep = depositStats.get(tid) ?? { total: 0, last: null };
          const wd = withdrawStats.get(tid) ?? { total: 0, last: null };
          const flow = dep.total + wd.total;
          return {
            telegramId: tid,
            username: r.username ?? null,
            firstName: r.first_name ?? null,
            lastName: r.last_name ?? null,
            balance: Number(r.balance ?? 0),
            totalDeposits: dep.total,
            totalWithdrawals: wd.total,
            // % share of this user's total money movement (deposits +
            // withdrawals) that each side accounts for — the two always
            // sum to 100 when there's any activity at all.
            depositRatePct: flow > 0 ? Math.round((dep.total / flow) * 1000) / 10 : 0,
            withdrawRatePct: flow > 0 ? Math.round((wd.total / flow) * 1000) / 10 : 0,
            lastDepositAt: dep.last,
            lastWithdrawalAt: wd.last,
          };
        }),
      );
    }

    // Manual balance deduction for the "Top Users" section: hard-floored at
    // the user's current balance (never goes negative), logged to
    // gm_balance_deductions with the acting admin and an optional reason,
    // and guarded against a concurrent balance change with the .eq('balance', ...)
    // filter below (the update simply matches zero rows if the balance moved
    // between the read and the write, which the caller can retry).
    if (method === 'POST' && action === 'deduct_balance' && id) {
      const raw = Number(body.amount);
      if (!Number.isFinite(raw) || raw <= 0) return json({ error: 'Invalid amount' }, 400);
      const amount = Math.round(raw * 1_000_000) / 1_000_000;
      const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 300) : null;

      const { data: u } = await db.from('gm_users').select('balance').eq('telegram_id', id).maybeSingle();
      if (!u) return json({ error: 'User not found' }, 404);
      const current = Number(u.balance ?? 0);
      if (amount > current + 1e-9) return json({ error: 'Amount exceeds current balance' }, 400);

      const next = Math.round((current - amount) * 1_000_000) / 1_000_000;
      const { data: updated, error } = await db
        .from('gm_users')
        .update({ balance: next })
        .eq('telegram_id', id)
        .eq('balance', current)
        .select('balance')
        .maybeSingle();
      if (error || !updated) return json({ error: 'Balance changed, please try again' }, 409);

      const balance = Number(updated.balance);
      const { error: logError } = await db.from('gm_balance_deductions').insert({
        telegram_id: id,
        amount,
        admin_id: guard.user.id,
        reason,
      });
      if (logError) console.error('[admin] failed to log balance deduction', logError);
      await notifyBalanceChange(id, 'gram', 'delta', -amount, balance).catch(() => undefined);
      return json({ ok: true, balance, logFailed: Boolean(logError) });
    }

    // Recent deduction history for one user, shown alongside the deduct button.
    if (method === 'GET' && action === 'deduction_log' && id) {
      const { data } = await db
        .from('gm_balance_deductions')
        .select('id, amount, admin_id, reason, created_at')
        .eq('telegram_id', id)
        .order('created_at', { ascending: false })
        .limit(20);
      return json(data ?? []);
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