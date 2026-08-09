import { createFileRoute } from '@tanstack/react-router';
import { handleWithdraw } from '@/lib/withdraw.server';

export const Route = createFileRoute('/api/telegram/withdraw')({
  server: { handlers: { POST: ({ request }) => handleWithdraw(request) } },
});