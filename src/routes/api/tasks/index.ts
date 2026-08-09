import { createFileRoute } from '@tanstack/react-router';
import { handleComboRequest } from '@/lib/combo.server';
import { handleTasksApi } from '@/lib/tasks.server';

const handle = ({ request }: { request: Request }) => {
  const url = new URL(request.url);
  if (url.searchParams.get('type') === 'combo') return handleComboRequest(request);
  return handleTasksApi(request, '');
};

export const Route = createFileRoute('/api/tasks/')({
  server: { handlers: { GET: handle, POST: handle } },
});
