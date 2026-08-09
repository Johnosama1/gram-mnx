import { createFileRoute } from '@tanstack/react-router';
import { handleTasksApi } from '@/lib/tasks.server';

export const Route = createFileRoute('/api/tasks/verify-twitter')({
  server: { handlers: { POST: ({ request }) => handleTasksApi(request, 'verify-twitter') } },
});
