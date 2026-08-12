import { createFileRoute } from '@tanstack/react-router';
import { createHash, timingSafeEqual } from 'node:crypto';
import { requireAdmin } from '@/lib/admin.server';

function matches(input: string, expected: string): boolean {
  const a = createHash('sha256').update(input, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}

async function handle({ request }: { request: Request }) {
  const auth = await requireAdmin(request);
  if (auth instanceof Response) return auth;

  const expected = process.env['ADMIN_PANEL_PASSWORD'];
  if (!expected) {
    return Response.json({ error: 'كلمة سر لوحة الأدمن غير مُعدّة' }, { status: 500 });
  }

  let password = '';
  try {
    password = String(((await request.json()) as { password?: string })?.password ?? '');
  } catch {
    password = '';
  }

  if (!password || !matches(password, expected)) {
    return Response.json({ ok: false }, { status: 401 });
  }
  return Response.json({ ok: true });
}

export const Route = createFileRoute('/api/admin/gate')({
  server: { handlers: { POST: handle } },
});
