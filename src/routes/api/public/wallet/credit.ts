import { createFileRoute } from '@tanstack/react-router';
import { handleWalletCredit } from '@/lib/inbound-wallet.server';

export const Route = createFileRoute('/api/public/wallet/credit')({
  server: { handlers: { POST: ({ request }) => handleWalletCredit(request) } },
});
