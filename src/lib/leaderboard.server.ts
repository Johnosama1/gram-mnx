import { json } from '@/lib/admin.server';
import { getDb } from '@/lib/telegram-user.server';
import { notifyUser, getAllAdminIds } from '@/lib/admin.server';


type Prize = { rank: number; coins?: number; gram?: number };

/**
 * Settles every tournament whose end time has passed: snapshots the top N,
 * pays the prizes, and notifies the winners. Idempotent — the row is only
 * settled once because the update is filtered on `status = 'active'`.
 */
export async function settleDueTournaments(): Promise<number> {
  const db = (await getDb()) as any;
  const nowIso = new Date().toISOString();
  const { data: due } = await db
    .from('gm_tournaments')
    .select('*')
    .eq('status', 'active')
    .lte('ends_at', nowIso);

  let settled = 0;
  for (const t of (due ?? []) as Array<Record<string, any>>) {
    // Claim the tournament first so concurrent requests cannot pay twice.
    const { data: claimed } = await db
      .from('gm_tournaments')
      .update({ status: 'settled', settled_at: nowIso })
      .eq('id', t.id)
      .eq('status', 'active')
      .select('id')
      .maybeSingle();
    if (!claimed?.id) continue;

    const isCoin = (t.tournament_type ?? 'gram') === 'coin';
    const column = isCoin ? 'coins' : 'balance';
    const topN = Math.max(1, Number(t.top_n ?? 10));

    const { data: rows } = await db
      .from('gm_users')
      .select(`telegram_id, first_name, username, ${column}`)
      .eq('is_banned', false)
      .gt(column, 0)
      .order(column, { ascending: false })
      .limit(topN);

    let prizes: Prize[] = [];
    try {
      prizes = JSON.parse(t.prizes ?? '[]');
    } catch {
      prizes = [];
    }

    const winners: Array<Record<string, unknown>> = [];
    const adminLines: string[] = [];
    let rank = 0;
    for (const u of (rows ?? []) as Array<Record<string, any>>) {
      rank += 1;
      const prize = prizes.find((p) => Number(p.rank) === rank);
      const amount = Number(prize?.coins ?? prize?.gram ?? 0) || 0;
      const name = u.username
        ? `@${u.username}`
        : String(u.first_name ?? u.telegram_id);
      winners.push({ rank, telegramId: Number(u.telegram_id), amount });
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
      adminLines.push(
        `${medal} ${name} (<code>${u.telegram_id}</code>) — ${amount} ${isCoin ? 'coin' : 'GRAM'}`,
      );
      if (amount <= 0) continue;

      const current = Number(u[column] ?? 0);
      await db
        .from('gm_users')
        .update({ [column]: current + amount })
        .eq('telegram_id', u.telegram_id);
      await notifyUser(
        Number(u.telegram_id),
        [
          `🏆 <b>${t.title}</b> has ended!`,
          '',
          `You finished at rank #${rank}.`,
          `🎁 Prize: <b>${amount} ${isCoin ? 'coin' : 'GRAM'}</b> added to your balance.`,
        ].join('\n'),
      ).catch(() => undefined);
    }

    // Admin summary — full ranking with the prize each winner received.
    try {
      const adminIds = await getAllAdminIds();
      const text = [
        `🏁 <b>${t.title}</b> — tournament ended`,
        `Type: ${isCoin ? 'coin' : 'GRAM'} • Winners: ${winners.length}`,
        '',
        ...(adminLines.length ? adminLines : ['No winners']),
      ].join('\n');
      for (const id of adminIds) {
        await notifyUser(id, text).catch(() => undefined);
      }
    } catch { /* best-effort */ }

    await db
      .from('gm_tournaments')
      .update({ snapshot: JSON.stringify(winners) })
      .eq('id', t.id);

    settled += 1;
  }
  return settled;
}

interface UserRow {
  telegram_id: number;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  coins: number | null;
}

/** Top users ranked by coin balance (highest first). */
export async function handleLeaderboard(request: Request) {
  const url = new URL(request.url);
  // Pay out finished tournaments without waiting for any manual step.
  await settleDueTournaments().catch(() => undefined);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 20, 1), 100);
  const db = (await getDb()) as any;

  const { data, error } = await db
    .from('gm_users')
    .select('telegram_id, first_name, last_name, username, coins')
    .eq('is_banned', false)
    .gt('coins', 0)
    .order('coins', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('leaderboard query failed:', error.message);
    return json([], 200);
  }

  const rows = (data ?? []) as UserRow[];
  return json(
    rows.map((u, i) => ({
      rank: i + 1,
      telegramId: Number(u.telegram_id),
      firstName: u.first_name,
      lastName: u.last_name,
      username: u.username,
      balance: Number(u.coins ?? 0),
    })),
  );
}

/** Active tournament of a given type, if any. */
export async function handleActiveTournament(request: Request) {
  const url = new URL(request.url);
  await settleDueTournaments().catch(() => undefined);
  const type = url.searchParams.get('type') || 'coin';
  const db = (await getDb()) as any;

  const { data, error } = await db
    .from('gm_tournaments')
    .select('*')
    .eq('status', 'active')
    .eq('tournament_type', type)
    .gt('ends_at', new Date().toISOString())
    .order('ends_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data) return json({ tournament: null });

  let prizes: unknown = [];
  try { prizes = JSON.parse(data.prizes ?? '[]'); } catch { prizes = []; }

  return json({
    tournament: {
      id: data.id,
      title: data.title,
      topN: data.top_n,
      prizes,
      startsAt: data.starts_at,
      endsAt: data.ends_at,
      status: data.status,
      tournamentType: data.tournament_type,
    },
  });
}