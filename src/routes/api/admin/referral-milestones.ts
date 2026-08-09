import { createFileRoute } from '@tanstack/react-router';
import { getAdminDb, json, mapMilestone, requireAdmin } from '@/lib/admin.server';

async function handle({ request }: { request: Request }): Promise<Response> {
  const guard = await requireAdmin(request);
  if (guard instanceof Response) return guard;
  const db = (await getAdminDb()) as any;

  try {
    if (request.method === 'GET') {
      const { data } = await db
        .from('gm_referral_milestones')
        .select('*')
        .order('invite_count');
      return json((data ?? []).map(mapMilestone));
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, any>;
    const inviteCount = Number(body.inviteCount);
    const rewardCoins = Number(body.rewardCoins);
    if (!Number.isFinite(inviteCount) || inviteCount <= 0)
      return json({ error: 'inviteCount must be > 0' }, 400);
    if (!Number.isFinite(rewardCoins) || rewardCoins < 0)
      return json({ error: 'rewardCoins must be >= 0' }, 400);
    const { data, error } = await db
      .from('gm_referral_milestones')
      .insert({ invite_count: inviteCount, reward_coins: rewardCoins, is_enabled: true })
      .select('*')
      .single();
    if (error) return json({ error: error.message }, 400);
    return json(mapMilestone(data));
  } catch (err) {
    console.error(err);
    return json({ error: 'Internal server error' }, 500);
  }
}

export const Route = createFileRoute('/api/admin/referral-milestones')({
  server: { handlers: { GET: handle, POST: handle } },
});