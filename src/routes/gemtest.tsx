import { createFileRoute, ClientOnly } from '@tanstack/react-router';
import { Suspense, lazy } from 'react';

const Gem3D = lazy(() => import('@/components/Gem3D'));

export const Route = createFileRoute('/gemtest')({
  component: () => (
    <div style={{ width: 390, height: 500, background: '#fff' }}>
      <ClientOnly>
        <Suspense fallback={null}>
          <Gem3D active />
        </Suspense>
      </ClientOnly>
    </div>
  ),
});
