import { createFileRoute } from '@tanstack/react-router';
import { handleGiftStatus } from '@/lib/gift.server';

export const Route = createFileRoute('/api/gift/status')({
  server: { handlers: { GET: () => handleGiftStatus() } },
});
