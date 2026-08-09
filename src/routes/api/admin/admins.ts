import { createFileRoute } from '@tanstack/react-router';
import { handleAdminGeneral } from '@/lib/admin-general.server';

const handle = ({ request }: { request: Request }) => handleAdminGeneral(request, 'admins');

export const Route = createFileRoute('/api/admin/admins')({
  server: { handlers: { GET: handle, POST: handle, PATCH: handle, DELETE: handle } },
});
