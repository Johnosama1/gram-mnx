import { createFileRoute } from '@tanstack/react-router';
import { getAdminDb, json, mapMilestone, requireAdmin } from '@/lib/admin.server';

async function handle({
  request,
  params,
}: {
  request: Request;
  params: { id: string };
}): Promise<Response> {
  const guard = await requireAdmin(request);
  if (guard instanceof Response) return guard;
  const id = Number(params.id);
  if (!Number.isFinite(id)) return json({ error: 'invalid id' }, 400);
  const db = (await getAdminDb()) as any;

  try {
    if (request.method === 'DELETE') {
      await db.from('gm_referral_milestones').delete().eq('id', id);
      return json({ ok: true });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, any>;
    const updates: Record<string, unknown> = {};
    if (body.isEnabled !== undefined) updates.is_enabled = Boolean(body.isEnabled);
    if (body.inviteCount !== undefined) updates.invite_count = Number(body.inviteCount);
    if (body.rewardCoins !== undefined) updates.reward_coins = Number(body.rewardCoins);
    if (!Object.keys(updates).length) return json({ error: 'nothing to update' }, 400);
    const { data, error } = await db
      .from('gm_referral_milestones')
      .update(updates)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) return json({ error: error.message }, 400);
    return json(data ? mapMilestone(data) : { ok: true });
  } catch (err) {
    console.error(err);
    return json({ error: 'Internal server error' }, 500);
  }
}

export const Route = createFileRoute('/api/admin/referral-milestones/$id')({
  server: { handlers: { PATCH: handle, DELETE: handle } },
});