import { getSetting } from '@/lib/admin.server';

export async function handleGiftStatus(): Promise<Response> {
  let enabled = false;
  let message = '';
  try {
    const [e, m] = await Promise.all([getSetting('gift_enabled'), getSetting('gift_message')]);
    enabled = String(e ?? 'false') === 'true';
    message = m ?? '';
  } catch {
    /* defaults: locked */
  }
  return new Response(JSON.stringify({ enabled, message }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
