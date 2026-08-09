import { createFileRoute } from '@tanstack/react-router';
import { handleLeaderboard } from '@/lib/leaderboard.server';

export const Route = createFileRoute('/api/leaderboard')({
  server: { handlers: { GET: ({ request }) => handleLeaderboard(request) } },
});