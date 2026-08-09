import { createFileRoute } from '@tanstack/react-router';
import { handleWithdrawStatus } from '@/lib/withdraw.server';

export const Route = createFileRoute('/api/telegram/withdraw/status')({
  server: { handlers: { GET: ({ request }) => handleWithdrawStatus(request) } },
});