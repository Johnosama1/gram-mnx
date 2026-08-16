import { createFileRoute } from '@tanstack/react-router';
import { handleTasksApi } from '@/lib/tasks.server';

const handle = ({ request }: { request: Request }) => handleTasksApi(request, 'ads-status');

export const Route = createFileRoute('/api/tasks/ads-status')({
  server: { handlers: { GET: handle } },
});
