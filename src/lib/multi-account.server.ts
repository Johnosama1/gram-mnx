import { getSetting } from '@/lib/admin.server';
import { getDb } from '@/lib/telegram-user.server';
import { rateLimit } from '@/lib/rate-limit.server';

/**
 * General multi-account protection: every account is fingerprinted by IP
 * (gm_user_ips, already recorded for the withdrawal-restriction feature)
 * and by a client-persisted device id (gm_user_devices, added for this
 * feature). Once a person's accounts sharing either signal exceed the
 * limit, the newest one over the limit is banned outright — the earlier
 * accounts already in good standing are left untouched.
 *
 * This is deliberately independent of enforceIpAccountLimit
 * (withdraw.server.ts), which only restricts withdrawals at a much higher
 * shared-IP threshold and never bans — a separate, harsher, and
 * admin-toggleable protection layered on top.
 */
export const MAX_ACCOUNTS_PER_PERSON = 3;

/** Admin-panel kill switch — off by default until explicitly enabled. */
export async function isMultiAccountProtectionEnabled(): Promise<boolean> {
  return (await getSetting('multi_account_protection_enabled')) === 'true';
}

/**
 * Bans `telegramId` if it is the 4th (or later) distinct account tied to
 * the same IP or device fingerprint. Called only right after a genuinely
 * new (user, ip) or (user, device) pairing is recorded — the set of linked
 * accounts can't have grown on a repeat visit, so there's nothing new to
 * catch otherwise.
 */
export async function enforceMultiAccountBan(telegramId: number): Promise<void> {
  if (!(await isMultiAccountProtectionEnabled())) return;
  try {
    const db = (await getDb()) as any;
    const [{ data: myIps }, { data: myDevices }] = await Promise.all([
      db.from('gm_user_ips').select('ip').eq('telegram_id', telegramId),
      db.from('gm_user_devices').select('device_id').eq('telegram_id', telegramId),
    ]);
    const ips = Array.from(new Set(((myIps ?? []) as { ip: string }[]).map((r) => r.ip)));
    const deviceIds = Array.from(
      new Set(((myDevices ?? []) as { device_id: string }[]).map((r) => r.device_id)),
    );
    if (!ips.length && !deviceIds.length) return;

    const [ipPeers, devicePeers] = await Promise.all([
      ips.length ? db.from('gm_user_ips').select('telegram_id').in('ip', ips) : { data: [] },
      deviceIds.length
        ? db.from('gm_user_devices').select('telegram_id').in('device_id', deviceIds)
        : { data: [] },
    ]);
    const linked = new Set<number>();
    for (const r of (ipPeers.data ?? []) as { telegram_id: number }[]) linked.add(Number(r.telegram_id));
    for (const r of (devicePeers.data ?? []) as { telegram_id: number }[]) linked.add(Number(r.telegram_id));
    linked.delete(telegramId);

    if (linked.size < MAX_ACCOUNTS_PER_PERSON) return;

    const { data: current } = await db
      .from('gm_users')
      .select('is_banned')
      .eq('telegram_id', telegramId)
      .maybeSingle();
    if (current?.is_banned) return;

    await db.from('gm_users').update({ is_banned: true }).eq('telegram_id', telegramId);

    try {
      const { notifyUser, getAllAdminIds } = await import('@/lib/admin.server');
      const admins = await getAllAdminIds();
      const text = [
        '🚫 حظر تلقائي — تعدد حسابات',
        `الحساب #${telegramId} اتحظر لأنه مرتبط بـ ${linked.size} حساب تاني على نفس الـ IP أو الجهاز (الحد الأقصى ${MAX_ACCOUNTS_PER_PERSON} حسابات للشخص الواحد).`,
      ].join('\n');
      await Promise.all(admins.map((id) => notifyUser(id, text).catch(() => undefined)));
    } catch {
      /* notification is best-effort — the ban itself already happened */
    }
  } catch {
    /* never block the request on this bookkeeping */
  }
}

/**
 * Records (telegram_id, device_id) the same way recordUserIp records
 * (telegram_id, ip): throttled per user, and the account-linking scan only
 * ever runs on a brand-new pairing.
 */
export async function recordUserDevice(telegramId: number, deviceId: string | null): Promise<void> {
  if (!deviceId) return;
  if (!(await rateLimit(`device-touch:${telegramId}`, 1, 180))) return;
  try {
    const db = (await getDb()) as any;
    const now = new Date().toISOString();
    const { data: existing } = await db
      .from('gm_user_devices')
      .select('id')
      .eq('telegram_id', telegramId)
      .eq('device_id', deviceId)
      .maybeSingle();
    if (existing) {
      await db.from('gm_user_devices').update({ last_seen_at: now }).eq('id', existing.id);
      return;
    }
    await db
      .from('gm_user_devices')
      .insert({ telegram_id: telegramId, device_id: deviceId, last_seen_at: now });
    await enforceMultiAccountBan(telegramId);
  } catch {
    /* never block the request on device bookkeeping */
  }
}
