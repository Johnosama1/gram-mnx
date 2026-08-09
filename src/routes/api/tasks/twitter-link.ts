import { createFileRoute } from '@tanstack/react-router';
import { handleTasksApi } from '@/lib/tasks.server';

export const Route = createFileRoute('/api/tasks/twitter-link')({
  server: {
    handlers: {
      GET: ({ request }) => handleTasksApi(request, 'twitter-link'),
      POST: ({ request }) => handleTasksApi(request, 'twitter-link'),
    },
  },
});
