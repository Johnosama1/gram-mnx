import { createFileRoute } from '@tanstack/react-router';
import { handleSwap } from '@/lib/swap.server';

export const Route = createFileRoute('/api/telegram/swap')({
  server: { handlers: { POST: ({ request }) => handleSwap(request) } },
});
