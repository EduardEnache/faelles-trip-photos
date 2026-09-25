/**
 * app root: session gate → shell (top bar / tab bar / tabs /
 * overlays / toast host). SCAFFOLD STUB: proves the integration compiles.
 * Replace entirely, keeping the slot usage from src/slots.ts.
 */
import { Suspense, useEffect } from 'react';
import { closeOverlay, useRoute } from '@/lib/router';
import { useSession } from '@/state/session';
import { useLibrary } from '@/state/library';
import { DayCaption, FeaturedMemoryCard, MemoriesTab, MemoryPlayer, PlacesTab } from '@/slots';
import { Wordmark } from '@/ui';

export default function Root() {
  const status = useSession((s) => s.status);
  const refresh = useSession((s) => s.refresh);
  const route = useRoute();

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (status !== 'ready') return;
    void useLibrary.getState().load();
    return useLibrary.getState().startLive();
  }, [status]);

  if (status !== 'ready') {
    return (
      <main style={{ padding: 'var(--s-6)' }}>
        <Wordmark />
      </main>
    );
  }

  return (
    <>
      <main>
        {route.tab === 'library' && (
          <>
            <FeaturedMemoryCard />
            <DayCaption day="2026-09-25" editable />
          </>
        )}
        <Suspense fallback={null}>
          {route.tab === 'memories' && <MemoriesTab />}
          {route.tab === 'places' && <PlacesTab />}
        </Suspense>
      </main>
      <Suspense fallback={null}>
        {route.memory && <MemoryPlayer memoryId={route.memory} onClose={closeOverlay} />}
      </Suspense>
    </>
  );
}
