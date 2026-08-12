/**
 * Server-side rate limiting for sensitive endpoints.
 *
 * Counters live in the database (gm_rate_limits) and are incremented inside a
 * row-locked SQL function, so limits hold across concurrent workers and cannot
 * be bypassed by racing requests or by anything the client sends.
 * Fails OPEN only for infrastructure errors, never for an exceeded limit.
 */
import { getDb } from '@/lib/telegram-user.server';

export async function rateLimit(
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  try {
    const db = (await getDb()) as any;
    const { data, error } = await db.rpc('gm_rate_limit_hit', {
      _bucket: bucket.slice(0, 180),
      _limit: limit,
      _window_seconds: windowSeconds,
    });
    if (error) return true;
    return data !== false;
  } catch {
    return true;
  }
}

/** Standard 429 response shape (message key kept generic, no internals leaked). */
export function tooMany(message = 'Too many requests, please slow down') {
  return new Response(JSON.stringify({ message, error: 'RATE_LIMITED' }), {
    status: 429,
    headers: { 'content-type': 'application/json' },
  });
}
