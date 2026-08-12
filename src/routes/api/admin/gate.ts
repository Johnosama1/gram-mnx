import { createFileRoute } from '@tanstack/react-router';
import { createHash, timingSafeEqual } from 'node:crypto';
import { requireAdmin } from '@/lib/admin.server';
import {
  ADMIN_SESSION_MAX_AGE,
  adminCookieHeader,
  hasAdminSession,
  signAdminSession,
} from '@/lib/telegram-auth.server';

function matches(input: string, expected: string): boolean {
  const a = createHash('sha256').update(input, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}

/** Checks whether the caller already holds a valid admin-gate session. */
async function check({ request }: { request: Request }) {
  const auth = await requireAdmin(request, { requireGate: false });
  if (auth instanceof Response) return auth;
  return Response.json({ ok: hasAdminSession(request, auth.user.id) });
}

async function unlock({ request }: { request: Request }) {
  // Telegram identity + admin-list membership are checked before the password
  // is even compared, so the gate can never be brute-forced by a normal user.
  const auth = await requireAdmin(request, { requireGate: false });
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

  // Fresh session id on every unlock → no session fixation, no reuse of an old
  // cookie value. HttpOnly, so browser JavaScript can never read or forge it.
  return Response.json(
    { ok: true },
    {
      headers: {
        'set-cookie': adminCookieHeader(signAdminSession(auth.user.id), ADMIN_SESSION_MAX_AGE),
      },
    },
  );
}

async function logout() {
  return Response.json({ ok: true }, { headers: { 'set-cookie': adminCookieHeader('', 0) } });
}

export const Route = createFileRoute('/api/admin/gate')({
  server: { handlers: { GET: check, POST: unlock, DELETE: logout } },
});
