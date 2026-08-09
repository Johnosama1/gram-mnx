import { createFileRoute } from '@tanstack/react-router';
import { handleTasksApi } from '@/lib/tasks.server';

export const Route = createFileRoute('/api/tasks/submit-bot')({
  server: { handlers: { POST: ({ request }) => handleTasksApi(request, 'submit-bot') } },
});
