/**
 * Security center: intrusion logging, risk scoring, and payout-wallet key
 * rotation from inside the admin panel.
 *
 * Events are stored as JSON in gm_settings so no schema change is needed.
 * The payout wallet secret override is stored AES-256-GCM encrypted with a
 * key derived from the bot token, so a plain database read never exposes it.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { getAllAdminIds, getBotToken, getSetting, notifyUser, setSetting } from '@/lib/admin.server';

export type SecuritySeverity = 'low' | 'medium' | 'high' | 'critical';

export type SecurityEvent = {
  id: string;
  at: string;
  type: string;
  severity: SecuritySeverity;
  telegramId?: number | null;
  username?: string | null;
  ip?: string | null;
  country?: string | null;
  detail?: string | null;
  path?: string | null;
};

const EVENTS_KEY = 'security_events';
const SECRET_KEY = 'payout_secret_enc';
const MAX_EVENTS = 150;

const WEIGHT: Record<SecuritySeverity, number> = { low: 2, medium: 6, high: 14, critical: 28 };

export function clientIp(request: Request): string | null {
  const h = request.headers;
  return (
    h.get('cf-connecting-ip') ||
    h.get('x-real-ip') ||
    (h.get('x-forwarded-for') ?? '').split(',')[0]?.trim() ||
    null
  );
}

export async function readSecurityEvents(): Promise<SecurityEvent[]> {
  try {
    const raw = await getSetting(EVENTS_KEY);
    const list = raw ? (JSON.parse(raw) as SecurityEvent[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function riskScore(events: SecurityEvent[]): number {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  let score = 0;
  for (const e of events) {
    if (new Date(e.at).getTime() < since) continue;
    score += WEIGHT[e.severity] ?? 2;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function riskLabel(score: number): 'آمن' | 'منخفض' | 'متوسط' | 'مرتفع' | 'خطر' {
  if (score >= 80) return 'خطر';
  if (score >= 55) return 'مرتفع';
  if (score >= 30) return 'متوسط';
  if (score >= 10) return 'منخفض';
  return 'آمن';
}

/** Records a security event, keeps the log capped, and alerts every admin. */
export async function logSecurityEvent(
  input: Omit<SecurityEvent, 'id' | 'at'> & { notify?: boolean },
): Promise<SecurityEvent> {
  const { notify = true, ...rest } = input;
  const event: SecurityEvent = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    ...rest,
  };

  const events = await readSecurityEvents();
  const next = [event, ...events].slice(0, MAX_EVENTS);
  try {
    await setSetting(EVENTS_KEY, JSON.stringify(next));
  } catch {
    // Never let logging break the request it is protecting.
  }

  if (notify) {
    const score = riskScore(next);
    const lines = [
      '🚨 <b>تنبيه أمني</b>',
      `النوع: <b>${escapeHtml(event.type)}</b>`,
      `الخطورة: <b>${event.severity.toUpperCase()}</b>`,
      event.telegramId ? `المستخدم: <code>${event.telegramId}</code>` : null,
      event.username ? `اليوزر: @${escapeHtml(event.username)}` : null,
      event.ip ? `IP: <code>${escapeHtml(event.ip)}</code>` : null,
      event.country ? `الدولة: ${escapeHtml(event.country)}` : null,
      event.path ? `المسار: <code>${escapeHtml(event.path)}</code>` : null,
      event.detail ? `التفاصيل: ${escapeHtml(event.detail)}` : null,
      `الوقت: ${event.at}`,
      `مستوى الخطر الحالي: <b>${score}%</b> (${riskLabel(score)})`,
    ].filter(Boolean);
    const text = lines.join('\n');
    try {
      const admins = await getAllAdminIds();
      await Promise.all(admins.map((id) => notifyUser(id, text)));
    } catch {
      // ignore notification failures
    }
  }

  return event;
}

export async function clearSecurityEvents(): Promise<void> {
  await setSetting(EVENTS_KEY, '[]');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Payout wallet key rotation ────────────────────────────────────────────

function cryptoKey(): Buffer {
  const base = getBotToken() ?? process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? 'gramminer-fallback';
  return createHash('sha256').update(`gm-payout::${base}`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', cryptoKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

export function decryptSecret(stored: string): string | null {
  try {
    const buf = Buffer.from(stored, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', cryptoKey(), buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Admin-set payout secret that overrides the environment variable. */
export async function getPayoutSecretOverride(): Promise<string | undefined> {
  const stored = await getSetting(SECRET_KEY);
  if (!stored) return undefined;
  return decryptSecret(stored) ?? undefined;
}

export async function setPayoutSecretOverride(plain: string): Promise<void> {
  await setSetting(SECRET_KEY, encryptSecret(plain.trim()));
}

export async function clearPayoutSecretOverride(): Promise<void> {
  await setSetting(SECRET_KEY, '');
}
