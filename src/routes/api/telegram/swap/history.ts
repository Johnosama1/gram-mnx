import { createFileRoute } from '@tanstack/react-router';
import { handleSwapHistory } from '@/lib/swap.server';

export const Route = createFileRoute('/api/telegram/swap/history')({
  server: { handlers: { GET: ({ request }) => handleSwapHistory(request) } },
});
