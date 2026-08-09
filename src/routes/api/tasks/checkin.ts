import { createFileRoute } from '@tanstack/react-router';
import { handleTasksApi } from '@/lib/tasks.server';

const handle = ({ request }: { request: Request }) => handleTasksApi(request, 'checkin');

export const Route = createFileRoute('/api/tasks/checkin')({
  server: { handlers: { GET: handle, POST: handle } },
});