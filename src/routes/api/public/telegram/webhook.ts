import { createFileRoute } from '@tanstack/react-router';
import { createHash, timingSafeEqual } from 'node:crypto';
import { getBotToken } from '@/lib/admin.server';
import type { TgUpdate } from '@/lib/bot.server';

function deriveSecret(token: string): string {
  return createHash('sha256').update(`telegram-webhook:${token}`).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export const Route = createFileRoute('/api/public/telegram/webhook')({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, service: 'telegram-webhook' }),
      POST: async ({ request }) => {
        const token = getBotToken();
        if (!token) return new Response('Bot not configured', { status: 503 });

        const provided = request.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? '';
        if (!safeEqual(provided, deriveSecret(token))) {
          return new Response('Unauthorized', { status: 401 });
        }

        const update = (await request.json().catch(() => null)) as TgUpdate | null;
        if (!update) return Response.json({ ok: true, ignored: true });

        try {
          const { handleUpdate } = await import('@/lib/bot.server');
          await handleUpdate(update);
        } catch (err) {
          // Always ACK Telegram with 200 so it never backs off / disables the webhook.
          console.error('Bot update failed:', err);
          return Response.json({ ok: true, handled: false });
        }
        return Response.json({ ok: true });
      },
    },
  },
});
