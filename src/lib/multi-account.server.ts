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

/** Admin-panel kill switch — on by default, can be turned off from Security. */
export async function isMultiAccountProtectionEnabled(): Promise<boolean> {
  return (await getSetting('multi_account_protection_enabled')) !== 'false';
}

/** PostgREST's "relation not found in schema cache" — the migration that creates gm_user_devices was never applied. */
function isMissingTableError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === 'PGRST205' || code === '42P01';
}

let reportedMissingTable = false;

/** Surfaces a missing gm_user_devices table to admins over Telegram — Worker logs aren't reachable from the admin panel. */
async function reportMissingDevicesTable(error: unknown) {
  console.error('[multi-account] gm_user_devices not found', error);
  if (reportedMissingTable) return; // once per warm isolate is enough to get the point across
  reportedMissingTable = true;
  try {
    const { notifyUser, getAllAdminIds } = await import('@/lib/admin.server');
    const admins = await getAllAdminIds();
    const text =
      '⚠️ حماية تعدد الحسابات مش شغالة\n' +
      'جدول gm_user_devices مش موجود في قاعدة البيانات. ' +
      'نفّذ الملف supabase/migrations/20260825060000_multi_account_devices.sql في Supabase SQL Editor عشان الحماية تشتغل.';
    await Promise.all(admins.map((id) => notifyUser(id, text).catch(() => undefined)));
  } catch {
    /* best-effort */
  }
}

/**
 * Bans every account beyond the earliest MAX_ACCOUNTS_PER_PERSON in a
 * IP/device cluster — ranked by account creation date, not by which one
 * happens to trigger this check. That distinction matters: this runs
 * whenever ANY account in the cluster records a new IP or device pairing,
 * which for an already-established account can happen long after it
 * joined (a new wifi network, a cleared app cache regenerating the device
 * id). Banning "whoever triggered the check once 3+ others are linked"
 * would eventually catch a genuinely first-in, innocent account the
 * moment it happened to touch a new IP/device after enough newer accounts
 * had piled up on the same cluster. Ranking by creation date instead means
 * the first 3 accounts a person ever made are permanently exempt no
 * matter how the cluster grows or who triggers the re-check, and every
 * account after that gets (re-)banned in the same pass — not just the one
 * that happened to trigger it. Admin accounts are excluded entirely (see
 * below) rather than relying on creation order to protect them.
 */
export async function enforceMultiAccountBan(telegramId: number): Promise<void> {
  if (!(await isMultiAccountProtectionEnabled())) return;
  try {
    // Admins test this very feature from shared devices/IPs and must never
    // be able to lock themselves out of the panel they'd need to fix it
    // from. Exempt entirely: never evaluated, never banned, and stripped
    // out of anyone else's cluster below so an admin's account never
    // inflates another person's linked-account count either.
    const { getAllAdminIds } = await import('@/lib/admin.server');
    const adminIds = new Set(await getAllAdminIds());
    if (adminIds.has(telegramId)) return;

    const db = (await getDb()) as any;
    const [ipRes, deviceRes] = await Promise.all([
      db.from('gm_user_ips').select('ip').eq('telegram_id', telegramId),
      db.from('gm_user_devices').select('device_id').eq('telegram_id', telegramId),
    ]);
    if (deviceRes.error) {
      if (isMissingTableError(deviceRes.error)) await reportMissingDevicesTable(deviceRes.error);
      else console.error('[multi-account] failed to read my devices', deviceRes.error);
    }
    const ips = Array.from(new Set(((ipRes.data ?? []) as { ip: string }[]).map((r) => r.ip)));
    const deviceIds = Array.from(
      new Set(((deviceRes.data ?? []) as { device_id: string }[]).map((r) => r.device_id)),
    );
    if (!ips.length && !deviceIds.length) return;

    const [ipPeers, devicePeers] = await Promise.all([
      ips.length ? db.from('gm_user_ips').select('telegram_id').in('ip', ips) : { data: [] },
      deviceIds.length
        ? db.from('gm_user_devices').select('telegram_id').in('device_id', deviceIds)
        : { data: [] },
    ]);
    const cluster = new Set<number>([telegramId]);
    for (const r of (ipPeers.data ?? []) as { telegram_id: number }[]) cluster.add(Number(r.telegram_id));
    for (const r of (devicePeers.data ?? []) as { telegram_id: number }[]) cluster.add(Number(r.telegram_id));
    for (const id of adminIds) cluster.delete(id);

    if (cluster.size <= MAX_ACCOUNTS_PER_PERSON) return;

    const { data: userRows } = await db
      .from('gm_users')
      .select('telegram_id, created_at, is_banned')
      .in('telegram_id', [...cluster]);
    const rows = (userRows ?? []) as { telegram_id: number; created_at: string; is_banned: boolean }[];
    rows.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    const overLimit = rows.slice(MAX_ACCOUNTS_PER_PERSON).filter((r) => !r.is_banned);
    if (overLimit.length === 0) return;

    const idsToBan = overLimit.map((r) => Number(r.telegram_id));
    // .select() after .update() so the response echoes back the rows
    // Postgres actually wrote — the notification below only ever claims a
    // ban succeeded once the database itself confirms is_banned is true,
    // instead of trusting a call that could fail (or silently match zero
    // rows) without ever throwing.
    const { data: writeResult, error: banError } = await db
      .from('gm_users')
      .update({ is_banned: true })
      .in('telegram_id', idsToBan)
      .select('telegram_id, is_banned');

    if (banError) {
      console.error('[multi-account] ban update failed', banError);
      try {
        const { notifyUser, getAllAdminIds } = await import('@/lib/admin.server');
        const admins = await getAllAdminIds();
        const text = [
          '⚠️ فشل تنفيذ حظر تعدد الحسابات فعليًا',
          `الحسابات المفروض تتحظر: ${idsToBan.map((id) => `#${id}`).join(', ')}`,
          `سبب الفشل: ${banError.message ?? String(banError)}`,
        ].join('\n');
        await Promise.all(admins.map((id) => notifyUser(id, text).catch(() => undefined)));
      } catch {
        /* best-effort */
      }
      return;
    }

    const confirmedBanned = new Set(
      ((writeResult ?? []) as { telegram_id: number; is_banned: boolean }[])
        .filter((r) => r.is_banned)
        .map((r) => Number(r.telegram_id)),
    );
    const notConfirmed = idsToBan.filter((id) => !confirmedBanned.has(id));

    try {
      const { notifyUser, getAllAdminIds } = await import('@/lib/admin.server');
      const admins = await getAllAdminIds();
      // Full ranking, not just who got banned — so a report of "the wrong
      // accounts got banned" can be checked against the exact order and
      // timestamps the server actually used, instead of guessing.
      const rankLines = rows.map((r, i) => {
        const mark = i < MAX_ACCOUNTS_PER_PERSON ? '✅ آمن' : r.is_banned ? '🚫 محظور (كان محظور بالفعل)' : '🚫 اتحظر الآن';
        return `${i + 1}. #${r.telegram_id} — ${r.created_at} — ${mark}`;
      });
      const text = [
        '🚫 حظر تلقائي — تعدد حسابات',
        `تم حظر فعليًا (مؤكد من قاعدة البيانات): ${confirmedBanned.size ? [...confirmedBanned].map((id) => `#${id}`).join(', ') : 'لا حساب'}`,
        ...(notConfirmed.length
          ? [`⚠️ مطلوب حظرهم لكن قاعدة البيانات ما أكدتش الحظر: ${notConfirmed.map((id) => `#${id}`).join(', ')}`]
          : []),
        '',
        `ترتيب المجموعة كاملة (الأقدم أولًا، أول ${MAX_ACCOUNTS_PER_PERSON} آمنين دايمًا):`,
        ...rankLines,
      ].join('\n');
      await Promise.all(admins.map((id) => notifyUser(id, text).catch(() => undefined)));
    } catch {
      /* notification is best-effort — the ban itself already happened */
    }
  } catch (err) {
    console.error('[multi-account] enforceMultiAccountBan failed', err);
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
    const { data: existing, error: selectError } = await db
      .from('gm_user_devices')
      .select('id')
      .eq('telegram_id', telegramId)
      .eq('device_id', deviceId)
      .maybeSingle();
    if (selectError) {
      if (isMissingTableError(selectError)) await reportMissingDevicesTable(selectError);
      else console.error('[multi-account] device lookup failed', selectError);
      return;
    }
    if (existing) {
      await db.from('gm_user_devices').update({ last_seen_at: now }).eq('id', existing.id);
      return;
    }
    const { error: insertError } = await db
      .from('gm_user_devices')
      .insert({ telegram_id: telegramId, device_id: deviceId, last_seen_at: now });
    if (insertError) {
      if (isMissingTableError(insertError)) await reportMissingDevicesTable(insertError);
      else console.error('[multi-account] device insert failed', insertError);
      return;
    }
    await enforceMultiAccountBan(telegramId);
  } catch (err) {
    console.error('[multi-account] recordUserDevice failed', err);
  }
}
