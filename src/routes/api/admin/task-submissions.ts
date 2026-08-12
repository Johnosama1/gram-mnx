import { createFileRoute } from '@tanstack/react-router';
import { getAdminDb, json, notifyUser, requireAdmin } from '@/lib/admin.server';

async function handle({ request }: { request: Request }): Promise<Response> {
  const guard = await requireAdmin(request);
  if (guard instanceof Response) return guard;
  const db = (await getAdminDb()) as any;
  const url = new URL(request.url);

  try {
    if (request.method === 'GET') {
      const status = url.searchParams.get('status');
      let q = db
        .from('gm_task_submissions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      if (status) q = q.eq('status', status);
      const { data } = await q;
      const rows = data ?? [];
      const taskIds = [...new Set(rows.map((r: any) => Number(r.task_id)))];
      const userIds = [...new Set(rows.map((r: any) => Number(r.telegram_id)))];
      const titles: Record<string, string> = {};
      const names: Record<string, any> = {};
      if (taskIds.length) {
        const { data: tasks } = await db.from('gm_tasks').select('id,title').in('id', taskIds);
        for (const t of tasks ?? []) titles[String(t.id)] = t.title;
      }
      if (userIds.length) {
        const { data: users } = await db
          .from('gm_users')
          .select('telegram_id,first_name,username')
          .in('telegram_id', userIds);
        for (const u of users ?? []) names[String(u.telegram_id)] = u;
      }
      return json(
        rows.map((r: any) => ({
          id: r.id,
          telegramId: Number(r.telegram_id),
          taskId: Number(r.task_id),
          taskTitle: titles[String(r.task_id)] ?? `#${r.task_id}`,
          kind: r.kind,
          payload: r.payload,
          status: r.status,
          rejectReason: r.reject_reason ?? null,
          firstName: names[String(r.telegram_id)]?.first_name ?? null,
          username: names[String(r.telegram_id)]?.username ?? null,
          createdAt: r.created_at,
        })),
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, any>;
    const id = Number(url.searchParams.get('id') ?? body.id);
    const action = url.searchParams.get('action') ?? body.action;
    if (!id || (action !== 'approve' && action !== 'reject'))
      return json({ error: 'id and action (approve|reject) required' }, 400);

    const { data: sub } = await db
      .from('gm_task_submissions')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (!sub) return json({ error: 'Not found' }, 404);
    if (sub.status === 'approved') return json({ error: 'Already approved' }, 400);

    if (action === 'reject') {
      const reason = String(body.reason ?? 'Rejected by an administrator');
      await db
        .from('gm_task_submissions')
        .update({ status: 'rejected', reject_reason: reason, reviewed_at: new Date().toISOString() })
        .eq('id', id);
      await notifyUser(Number(sub.telegram_id), `❌ Your task proof was rejected.\nReason: ${reason}`);
      return json({ ok: true });
    }

    const { data: task } = await db
      .from('gm_tasks')
      .select('id,reward,title')
      .eq('id', sub.task_id)
      .maybeSingle();
    const reward = Number(task?.reward ?? 0);

    await db
      .from('gm_task_submissions')
      .update({ status: 'approved', reject_reason: null, reviewed_at: new Date().toISOString() })
      .eq('id', id);

    const { data: done } = await db
      .from('gm_task_completions')
      .select('id')
      .eq('telegram_id', sub.telegram_id)
      .eq('task_id', sub.task_id)
      .maybeSingle();
    if (!done) {
      await db
        .from('gm_task_completions')
        .insert({ telegram_id: sub.telegram_id, task_id: sub.task_id });
      await db.rpc('gm_add_coins', { _telegram_id: sub.telegram_id, _amount: reward });
    }

    await notifyUser(
      Number(sub.telegram_id),
      `✅ Your proof for "${task?.title ?? ''}" was approved and ${reward} coin was added to your balance.`,
    );
    return json({ ok: true });
  } catch (err) {
    console.error(err);
    return json({ error: 'Internal server error' }, 500);
  }
}

export const Route = createFileRoute('/api/admin/task-submissions')({
  server: { handlers: { GET: handle, POST: handle } },
});
