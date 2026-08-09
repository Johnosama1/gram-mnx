import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/public/health')({
  server: {
    handlers: {
      GET: async () =>
        Response.json({
          ok: true,
          uptime: true,
          time: new Date().toISOString(),
        }),
    },
  },
});
