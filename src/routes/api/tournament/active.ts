import { createFileRoute } from '@tanstack/react-router';
import { handleActiveTournament } from '@/lib/leaderboard.server';

export const Route = createFileRoute('/api/tournament/active')({
  server: { handlers: { GET: ({ request }) => handleActiveTournament(request) } },
});