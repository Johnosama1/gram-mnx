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

/** Alerts every admin the first time a successful gate login is seen from a
 *  given IP for this admin id, then records it so it's "known" from then on. */
async function alertIfNewIp(request: Request, telegramId: number, username: string | null) {
  const { clientIp, logSecurityEvent } = await import('@/lib/security.server');
  const { getDb } = await import('@/lib/telegram-user.server');
  const { recordUserIp } = await import('@/lib/withdraw.server');
  const ip = clientIp(request);
  if (!ip) return;

  const db = (await getDb()) as any;
  const { data: known } = await db
    .from('gm_user_ips')
    .select('id')
    .eq('telegram_id', telegramId)
    .eq('ip', ip)
    .maybeSingle();

  if (!known) {
    await logSecurityEvent({
      type: 'تسجيل دخول ناجح للوحة الأدمن من IP جديد',
      severity: 'medium',
      telegramId,
      username,
      ip,
      path: '/api/admin/gate',
      detail: 'كلمة السر صحيحة، لكن هذا IP لم يُستخدم من قبل لهذا الأدمن',
    });
  }
  await recordUserIp(telegramId, ip);
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

  // Brute-force guard on the password itself (per verified Telegram admin id).
  const { rateLimit, tooMany } = await import('@/lib/rate-limit.server');
  if (!(await rateLimit(`admin-gate:${auth.user.id}`, 10, 300))) return tooMany();

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

  // A correct password from an IP never seen for this admin before is still
  // worth an immediate heads-up (e.g. the password leaked / session cookie
  // stolen) — this never blocks the login, only alerts the other admins.
  await alertIfNewIp(request, auth.user.id, auth.user.username ?? null).catch(() => undefined);

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
