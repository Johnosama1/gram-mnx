import { createFileRoute } from '@tanstack/react-router';
import { handleWalletSendHistory } from '@/lib/outbound-wallet.server';

export const Route = createFileRoute('/api/telegram/wallet/send/history')({
  server: { handlers: { GET: ({ request }) => handleWalletSendHistory(request) } },
});
