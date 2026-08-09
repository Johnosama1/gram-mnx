import { createFileRoute } from '@tanstack/react-router';
import { handlePromoApi } from '@/lib/promo.server';

const handle = ({ request }: { request: Request }) => handlePromoApi(request);

export const Route = createFileRoute('/api/promo')({
  server: { handlers: { GET: handle, POST: handle } },
});
