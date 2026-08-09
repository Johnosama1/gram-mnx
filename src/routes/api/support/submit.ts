import { createFileRoute } from '@tanstack/react-router';
import { handleSupportSubmit } from '@/lib/support.server';

export const Route = createFileRoute('/api/support/submit')({
  server: { handlers: { POST: ({ request }) => handleSupportSubmit(request) } },
});
