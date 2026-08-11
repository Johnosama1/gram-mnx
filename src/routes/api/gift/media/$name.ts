import { createFileRoute } from '@tanstack/react-router';
import { handleGiftMedia } from '@/lib/gift.server';

export const Route = createFileRoute('/api/gift/media/$name')({
  server: {
    handlers: {
      GET: ({ params }: { params: { name: string } }) => handleGiftMedia(params.name),
    },
  },
});
