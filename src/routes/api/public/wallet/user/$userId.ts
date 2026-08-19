import { createFileRoute } from '@tanstack/react-router';
import { handleWalletUserLookup } from '@/lib/inbound-wallet.server';

async function handle({ request, params }: { request: Request; params: { userId: string } }): Promise<Response> {
  return handleWalletUserLookup(request, params.userId);
}

export const Route = createFileRoute('/api/public/wallet/user/$userId')({
  server: { handlers: { GET: handle } },
});
