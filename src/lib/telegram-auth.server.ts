/**
 * Server-side Telegram Mini App authentication.
 *
 * Every request that touches app data must carry a Telegram `initData` string
 * signed by the bot token. Verification is HMAC based (Telegram's official
 * algorithm) and FAILS CLOSED: no bot token configured => no access at all.
 * Nothing here ever trusts a user id coming from the client, a query string,
 * localStorage or any header the browser can freely set.
 */
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

export type TelegramAuthUser = { id: number; username?: string; first_name?: string };

/**
 * initData older than this is rejected (replay-window limit).
 * Telegram does NOT refresh initData while a Mini App session stays open in
 * the client, so a short window logs real users out with "Missing User ID".
 */
const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;
const USER_COOKIE = 'gm_telegram_session';
const USER_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function getBotToken(): string | undefined {
  const t = process.env['BOT_TOKEN'] ?? process.env['TELEGRAM_BOT_TOKEN'];
  return t && t.trim() ? t.trim() : undefined;
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Verifies initData against the bot token. Returns null on ANY problem. */
export function verifyInitData(initData: string, token: string): TelegramAuthUser | null {
  if (!initData || !token) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const secretKey = createHmac('sha256', 'WebAppData').update(token).digest();
  const buildCheckString = (entries: [string, string][]) =>
    entries
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

  const all = [...params.entries()] as [string, string][];
  // Telegram (Bot API 8.0+) also sends `signature`; the official data-check
  // string keeps every received field except `hash`. Older clients don't send
  // it. Accept only a real HMAC match against either variant — never a bypass.
  const candidates = [all, all.filter(([k]) => k !== 'signature')];
  const matches = candidates.some((entries) => {
    const computed = createHmac('sha256', secretKey).update(buildCheckString(entries)).digest('hex');
    return safeEqualHex(computed, hash);
  });
  if (!matches) return null;


  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || authDate <= 0) return null;
  const age = Date.now() / 1000 - authDate;
  if (age > MAX_AUTH_AGE_SECONDS || age < -300) return null;

  const raw = params.get('user');
  if (!raw) return null;
  try {
    const user = JSON.parse(raw) as TelegramAuthUser;
    return typeof user?.id === 'number' && user.id > 0 ? user : null;
  } catch {
    return null;
  }
}

/** Strict resolver used everywhere: unsigned initData is never accepted. */
export function authenticateInitData(initData: string | null | undefined): TelegramAuthUser | null {
  const token = getBotToken();
  if (!token || !initData) return null;
  return verifyInitData(initData, token);
}

/** Pulls the raw initData out of a request (header, then JSON body). */
export async function extractInitData(
  request: Request,
  body?: { initData?: string } | null,
): Promise<string | null> {
  const header =
    request.headers.get('x-telegram-initdata') ??
    request.headers.get('x-init-data') ??
    null;
  if (header) return header;
  if (body?.initData) return body.initData;
  if (request.method === 'GET' || request.method === 'HEAD') return null;
  try {
    const cloned = request.clone();
    const text = await cloned.text();
    if (!text) return null;
    const parsed = JSON.parse(text) as { initData?: string };
    return typeof parsed?.initData === 'string' && parsed.initData ? parsed.initData : null;
  } catch {
    return null;
  }
}

/** Verified Telegram identity for a request, or null. */
export async function authenticateRequest(request: Request): Promise<TelegramAuthUser | null> {
  const sessionUser = verifyUserSession(readCookie(request, USER_COOKIE));
  if (sessionUser) return sessionUser;
  return authenticateInitData(await extractInitData(request));
}

function userSessionKey(): Buffer {
  const secret = process.env['TELEGRAM_SESSION_SECRET'];
  if (!secret) throw new Error('TELEGRAM_SESSION_SECRET is not configured');
  return createHash('sha256').update(`gm-user-session::${secret}`).digest();
}

export function signUserSession(user: TelegramAuthUser): string {
  const payload = JSON.stringify({
    id: user.id,
    username: user.username ?? null,
    first_name: user.first_name ?? null,
    exp: Date.now() + USER_SESSION_TTL_MS,
  });
  const encoded = Buffer.from(payload, 'utf8').toString('base64url');
  const signature = createHmac('sha256', userSessionKey()).update(encoded).digest('hex');
  return `${encoded}.${signature}`;
}

function verifyUserSession(raw: string | null): TelegramAuthUser | null {
  if (!raw) return null;
  const [encoded, signature] = raw.split('.');
  if (!encoded || !signature) return null;
  let expected: string;
  try {
    expected = createHmac('sha256', userSessionKey()).update(encoded).digest('hex');
  } catch {
    return null;
  }
  if (!safeEqualHex(expected, signature)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
      id?: number;
      username?: string | null;
      first_name?: string | null;
      exp?: number;
    };
    if (!Number.isFinite(parsed.id) || Number(parsed.id) <= 0 || !parsed.exp || parsed.exp <= Date.now()) {
      return null;
    }
    return {
      id: Number(parsed.id),
      username: parsed.username ?? undefined,
      first_name: parsed.first_name ?? undefined,
    };
  } catch {
    return null;
  }
}

export function userSessionCookieHeader(user: TelegramAuthUser): string {
  return [
    `${USER_COOKIE}=${encodeURIComponent(signUserSession(user))}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    // Telegram Desktop/Web render the Mini App in a cross-site iframe, where a
    // Lax cookie is never sent back. None+Secure+HttpOnly keeps it signed and
    // unreadable by scripts while still reaching the server from Telegram.
    'SameSite=None',

    `Max-Age=${Math.floor(USER_SESSION_TTL_MS / 1000)}`,
  ].join('; ');
}

// ─── Admin panel session (password gate) ───────────────────────────────────
//
// The password gate issues a short-lived HttpOnly cookie bound to the verified
// Telegram id. Admin APIs require BOTH a signed Telegram identity that is on
// the admin list AND this cookie, so knowing the URL is never enough.

export const ADMIN_COOKIE = 'gm_admin_session';
const ADMIN_SESSION_TTL_MS = 2 * 60 * 60 * 1000;

function sessionKey(): Buffer {
  const base = getBotToken() ?? process.env['ADMIN_PANEL_PASSWORD'] ?? '';
  return createHash('sha256').update(`gm-admin-session::${base}`).digest();
}

export function signAdminSession(telegramId: number): string {
  const payload = `${telegramId}.${Date.now() + ADMIN_SESSION_TTL_MS}.${randomId()}`;
  const sig = createHmac('sha256', sessionKey()).update(payload).digest('hex');
  return `${Buffer.from(payload, 'utf8').toString('base64url')}.${sig}`;
}

function randomId(): string {
  return createHash('sha256')
    .update(`${Date.now()}:${Math.random()}`)
    .digest('hex')
    .slice(0, 16);
}

function readCookie(request: Request, name: string): string | null {
  const raw = request.headers.get('cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/** True when the request carries a valid admin-gate cookie for this user. */
export function hasAdminSession(request: Request, telegramId: number): boolean {
  const raw = readCookie(request, ADMIN_COOKIE);
  if (!raw) return false;
  const [b64, sig] = raw.split('.');
  if (!b64 || !sig) return false;
  let payload: string;
  try {
    payload = Buffer.from(b64, 'base64url').toString('utf8');
  } catch {
    return false;
  }
  const expected = createHmac('sha256', sessionKey()).update(payload).digest('hex');
  if (!safeEqualHex(expected, sig)) return false;
  const [idStr, expStr] = payload.split('.');
  if (Number(idStr) !== telegramId) return false;
  const exp = Number(expStr);
  return Number.isFinite(exp) && exp > Date.now();
}

export function adminCookieHeader(value: string, maxAgeSeconds: number): string {
  return [
    `${ADMIN_COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=None',
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ');
}

export const ADMIN_SESSION_MAX_AGE = ADMIN_SESSION_TTL_MS / 1000;
