import { createFileRoute } from '@tanstack/react-router';
import { handleGiftLeaderboard } from '@/lib/gift.server';

const handle = ({ request }: { request: Request }) => handleGiftLeaderboard(request);

export const Route = createFileRoute('/api/gift/leaderboard')({
  server: { handlers: { GET: handle } },
});
