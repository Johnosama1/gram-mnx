import { createFileRoute } from '@tanstack/react-router';
import { handleSwapRate } from '@/lib/swap.server';

export const Route = createFileRoute('/api/telegram/swap/rate')({
  server: { handlers: { GET: () => handleSwapRate() } },
});
