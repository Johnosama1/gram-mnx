import { createFileRoute } from '@tanstack/react-router';
import { handleTasksApi } from '@/lib/tasks.server';

export const Route = createFileRoute('/api/tasks/completed')({
  server: { handlers: { GET: ({ request }) => handleTasksApi(request, 'completed') } },
});
