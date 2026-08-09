import { createFileRoute } from '@tanstack/react-router';
import { handleAdminGeneral } from '@/lib/admin-general.server';

const handle = ({ request }: { request: Request }) => handleAdminGeneral(request, 'channels');

export const Route = createFileRoute('/api/admin/channels')({
  server: { handlers: { GET: handle, POST: handle, PATCH: handle, DELETE: handle } },
});
