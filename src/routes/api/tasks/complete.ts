import { createFileRoute } from '@tanstack/react-router';
import { handleTasksApi } from '@/lib/tasks.server';

export const Route = createFileRoute('/api/tasks/complete')({
  server: { handlers: { POST: ({ request }) => handleTasksApi(request, 'complete') } },
});
