import { createFileRoute } from '@tanstack/react-router';
import { handleGiftApi } from '@/lib/gift.server';

const handle = ({ request }: { request: Request }) => handleGiftApi(request);

export const Route = createFileRoute('/api/gift/status')({
  server: { handlers: { GET: handle } },
});
