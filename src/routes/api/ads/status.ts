import { createFileRoute } from '@tanstack/react-router';
import { handleTasksApi } from '@/lib/tasks.server';

export const Route = createFileRoute('/api/ads/status')({
  server: { handlers: { GET: ({ request }) => handleTasksApi(request, 'ads-status') } },
});
