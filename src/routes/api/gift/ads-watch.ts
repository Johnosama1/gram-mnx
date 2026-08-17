import { createFileRoute } from '@tanstack/react-router';
import { handleGiftAdsWatch } from '@/lib/gift.server';

export const Route = createFileRoute('/api/gift/ads-watch')({
  server: { handlers: { POST: ({ request }) => handleGiftAdsWatch(request) } },
});
