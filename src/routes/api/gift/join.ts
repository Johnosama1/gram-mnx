import { createFileRoute } from '@tanstack/react-router';
import { handleGiftJoin } from '@/lib/gift.server';

export const Route = createFileRoute('/api/gift/join')({
  server: { handlers: { POST: ({ request }) => handleGiftJoin(request) } },
});
