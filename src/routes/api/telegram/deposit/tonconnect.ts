import { createFileRoute } from '@tanstack/react-router';
import { handleDepositTonconnect } from '@/lib/deposit.server';

export const Route = createFileRoute('/api/telegram/deposit/tonconnect')({
  server: { handlers: { POST: ({ request }) => handleDepositTonconnect(request) } },
});
