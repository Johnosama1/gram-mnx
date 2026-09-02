import { createFileRoute } from '@tanstack/react-router';
import { handleWithdrawAdsStatus } from '@/lib/withdraw.server';

export const Route = createFileRoute('/api/telegram/withdraw/ads-status')({
  server: { handlers: { GET: ({ request }) => handleWithdrawAdsStatus(request) } },
});
