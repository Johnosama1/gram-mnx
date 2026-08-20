import { createFileRoute } from '@tanstack/react-router';
import { handleWalletSend } from '@/lib/outbound-wallet.server';

export const Route = createFileRoute('/api/telegram/wallet/send')({
  server: { handlers: { POST: ({ request }) => handleWalletSend(request) } },
});
