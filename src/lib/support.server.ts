import { getAllAdminIds, notifyUser, json } from '@/lib/admin.server';
import { getDb, resolveTelegramUser } from '@/lib/telegram-user.server';

const MAX_LEN = 1000;

export async function handleSupportSubmit(request: Request): Promise<Response> {
  let body: { initData?: string; kind?: string; message?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ message: 'Invalid request' }, 400);
  }

  const initData = body.initData ?? request.headers.get('x-init-data') ?? '';
  const user = resolveTelegramUser(initData);
  if (!user) return json({ message: 'Could not verify your identity' }, 401);

  const kind = body.kind === 'suggestion' ? 'suggestion' : 'complaint';
  const message = String(body.message ?? '').trim();
  if (!message) return json({ message: 'Write your message first' }, 400);
  if (message.length > MAX_LEN) return json({ message: 'Message is too long' }, 400);

  const db = (await getDb()) as any;
  const { error } = await db.from('gm_support_messages').insert({
    telegram_id: user.id,
    username: user.username ?? null,
    kind,
    message,
  });
  if (error) return json({ message: 'Could not send the message' }, 500);

  const tag = user.username ? `@${user.username}` : String(user.id);
  const title = kind === 'suggestion' ? '💡 New suggestion' : '📩 New complaint';
  const escaped = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const text = `${title}\n\n👤 ${tag}\n🪪 <code>${user.id}</code>\n\n${escaped}`;
  for (const adminId of await getAllAdminIds()) {
    await notifyUser(adminId, text);
  }

  return json({ ok: true });
}
