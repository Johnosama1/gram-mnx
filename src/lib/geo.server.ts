import { getAdminDb } from '@/lib/admin.server';

export type CountryStat = {
  code: string;
  name: string;
  users: number;
  percent: number;
};

/** Skip private / local addresses that can never be geolocated. */
function isPublicIp(ip: string): boolean {
  if (!ip) return false;
  if (ip === '::1' || ip.startsWith('127.') || ip.startsWith('10.')) return false;
  if (ip.startsWith('192.168.') || ip.startsWith('169.254.')) return false;
  const m = /^172\.(\d+)\./.exec(ip);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return false;
  return true;
}

type Geo = { code: string; name: string };

/** Free, key-less IP geolocation (ipwho.is). Returns null when unknown. */
async function lookupIp(ip: string): Promise<Geo | null> {
  try {
    const res = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,country,country_code`);
    if (!res.ok) return null;
    const d = (await res.json()) as { success?: boolean; country?: string; country_code?: string };
    if (!d?.success || !d.country_code) return null;
    return { code: String(d.country_code).toUpperCase(), name: String(d.country ?? d.country_code) };
  } catch {
    return null;
  }
}

/** Resolve up to `limit` unknown IPs, a few at a time, and cache them in the DB. */
async function resolveMissing(db: any, ips: string[], limit = 300): Promise<Map<string, Geo>> {
  const out = new Map<string, Geo>();
  const todo = ips.filter(isPublicIp).slice(0, limit);
  const CHUNK = 10;
  for (let i = 0; i < todo.length; i += CHUNK) {
    const slice = todo.slice(i, i + CHUNK);
    const results = await Promise.all(slice.map((ip) => lookupIp(ip)));
    await Promise.all(
      slice.map(async (ip, idx) => {
        const geo = results[idx];
        if (!geo) return;
        out.set(ip, geo);
        await db
          .from('gm_user_ips')
          .update({ country_code: geo.code, country_name: geo.name })
          .eq('ip', ip);
      }),
    );
  }
  return out;
}

/**
 * Country distribution of bot users, based on the last IP seen per user.
 * Unknown IPs are geolocated on demand (in batches) and cached in gm_user_ips.
 */
export async function getCountryStats(): Promise<{
  countries: CountryStat[];
  known: number;
  unknown: number;
  totalUsers: number;
}> {
  const db = (await getAdminDb()) as any;

  const [{ count: totalUsers }, { data: rows }] = await Promise.all([
    db.from('gm_users').select('id', { count: 'exact', head: true }),
    db
      .from('gm_user_ips')
      .select('telegram_id, ip, country_code, country_name, last_seen_at')
      .order('last_seen_at', { ascending: false })
      .limit(20000),
  ]);

  // Keep only the most recent IP row per user.
  const latest = new Map<number, { ip: string; code: string | null; name: string | null }>();
  for (const r of rows ?? []) {
    const uid = Number(r.telegram_id);
    if (latest.has(uid)) continue;
    latest.set(uid, { ip: String(r.ip ?? ''), code: r.country_code ?? null, name: r.country_name ?? null });
  }

  const missing = [...new Set([...latest.values()].filter((v) => !v.code).map((v) => v.ip))];
  const resolved = missing.length ? await resolveMissing(db, missing) : new Map<string, Geo>();

  const tally = new Map<string, { name: string; users: number }>();
  let unknown = 0;
  for (const v of latest.values()) {
    const geo = v.code ? { code: v.code, name: v.name ?? v.code } : resolved.get(v.ip);
    if (!geo) {
      unknown++;
      continue;
    }
    const cur = tally.get(geo.code) ?? { name: geo.name, users: 0 };
    cur.users++;
    tally.set(geo.code, cur);
  }

  const known = [...tally.values()].reduce((s, c) => s + c.users, 0);
  const countries: CountryStat[] = [...tally.entries()]
    .map(([code, v]) => ({
      code,
      name: v.name,
      users: v.users,
      percent: known ? Math.round((v.users / known) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.users - a.users);

  // Users with no IP record at all also count as unknown.
  const total = totalUsers ?? latest.size;
  return { countries, known, unknown: Math.max(unknown, total - known), totalUsers: total };
}
