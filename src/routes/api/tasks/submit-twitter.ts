import { createFileRoute } from '@tanstack/react-router';
import { handleTasksApi } from '@/lib/tasks.server';

export const Route = createFileRoute('/api/tasks/submit-twitter')({
  server: { handlers: { POST: ({ request }) => handleTasksApi(request, 'submit-twitter') } },
});
