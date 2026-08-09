import { createFileRoute } from '@tanstack/react-router';
import { handleDepositStatus } from '@/lib/deposit.server';

export const Route = createFileRoute('/api/telegram/deposit/status')({
  server: { handlers: { GET: ({ request }) => handleDepositStatus(request) } },
});
