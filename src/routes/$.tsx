import { createFileRoute, redirect } from '@tanstack/react-router';

// Catch-all: any unknown path (old deep links, stale Telegram buttons, typos)
// redirects to the app root instead of showing a 404 screen.
export const Route = createFileRoute('/$')({
  beforeLoad: ({ params }) => {
    const splat = (params as { _splat?: string })._splat ?? '';
    if (splat.startsWith('api/')) return;
    throw redirect({ to: '/', replace: true });
  },
  component: () => null,
});
