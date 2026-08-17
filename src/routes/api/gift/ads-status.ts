import { createFileRoute } from '@tanstack/react-router';
import { handleGiftAdsStatus } from '@/lib/gift.server';

const handle = ({ request }: { request: Request }) => handleGiftAdsStatus(request);

export const Route = createFileRoute('/api/gift/ads-status')({
  server: { handlers: { GET: handle, POST: handle } },
});
