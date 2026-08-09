import { createFileRoute } from '@tanstack/react-router';
import { getBotToken } from '@/lib/admin.server';

/**
 * Streams a Telegram user's profile photo, keeping the bot token server-side.
 * GET /api/telegram/avatar/:id
 */
async function handle({ params }: { params: { id: string } }): Promise<Response> {
  const id = Number(params.id);
  const token = getBotToken();
  if (!Number.isFinite(id) || !token) return new Response('Not found', { status: 404 });

  try {
    const photosRes = await fetch(
      `https://api.telegram.org/bot${token}/getUserProfilePhotos?user_id=${id}&limit=1`,
    );
    const photos = (await photosRes.json()) as {
      ok?: boolean;
      result?: { photos?: Array<Array<{ file_id: string; width: number }>> };
    };
    const sizes = photos?.result?.photos?.[0];
    if (!sizes?.length) return new Response('Not found', { status: 404 });
    // Pick a medium size (~160px) to keep it light.
    const sorted = [...sizes].sort((a, b) => a.width - b.width);
    const chosen = sorted.find((s) => s.width >= 160) ?? sorted[sorted.length - 1];

    const fileRes = await fetch(
      `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(chosen.file_id)}`,
    );
    const file = (await fileRes.json()) as { result?: { file_path?: string } };
    const path = file?.result?.file_path;
    if (!path) return new Response('Not found', { status: 404 });

    const imgRes = await fetch(`https://api.telegram.org/file/bot${token}/${path}`);
    if (!imgRes.ok || !imgRes.body) return new Response('Not found', { status: 404 });

    return new Response(imgRes.body, {
      headers: {
        'Content-Type': imgRes.headers.get('content-type') ?? 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

export const Route = createFileRoute('/api/telegram/avatar/$id')({
  server: { handlers: { GET: handle } },
});