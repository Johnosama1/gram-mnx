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
        return json((data ?? []).map(mapUser));
      }
      const clean = q.replace(/^@/, '');
      const { data } = await db
        .from('gm_users')
        .select('*')
        .or(`username.ilike.${clean},first_name.ilike.%${clean}%`)
        .limit(20);
      return json((data ?? []).map(mapUser));
    }

    if (method === 'POST' && action === 'ban' && id) {
      await db.from('gm_users').update({ is_banned: Boolean(body.ban) }).eq('telegram_id', id);
      return json({ ok: true });
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