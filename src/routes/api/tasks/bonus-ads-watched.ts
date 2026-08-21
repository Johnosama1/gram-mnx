import { createFileRoute } from '@tanstack/react-router';
import { handleTasksApi } from '@/lib/tasks.server';

const handle = ({ request }: { request: Request }) => handleTasksApi(request, 'bonus-ads-watched');

export const Route = createFileRoute('/api/tasks/bonus-ads-watched')({
  server: { handlers: { POST: handle } },
});
