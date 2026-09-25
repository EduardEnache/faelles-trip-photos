/**
 * the app shell: top bar, tab content, tab bar / selection bar,
 * overlays (viewer, upload, memory player from the slots), toast host.
 */
import { Suspense, useEffect } from 'react';
import { closeOverlay, openUpload, useRoute } from '@/lib/router';
import { useWide } from '@/lib/useMedia';
import { MemoriesTab, MemoryPlayer, PlacesTab } from '@/slots';
import { useSelection } from '@/features/select/selectionStore';
import { SelectionBar } from '@/features/select/SelectionBar';
import { LibraryTab } from '@/features/library/LibraryTab';
import { Viewer } from '@/features/viewer/Viewer';
import { UploadSheet } from '@/features/upload/UploadSheet';
import { ToastHost } from '@/features/toast/ToastHost';
import { enqueueFiles } from '@/features/upload/uploadQueue';
import { TopBar } from './TopBar';
import { TabBar } from './TabBar';
import s from './Shell.module.css';

export function Shell() {
  const route = useRoute();
  const wide = useWide();
  const selectMode = useSelection((st) => st.active);

  // Desktop: dropping files anywhere on the page opens the upload sheet and
  // starts the upload, not just when dropped on the sheet's own drop zone.
  useEffect(() => {
    if (!wide) return;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
    const onDragOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const files = e.dataTransfer?.files;
      if (files && files.length) {
        openUpload();
        enqueueFiles(files);
      }
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [wide]);

  const showTabBar = !wide && !selectMode;

  return (
    <div className={s.root}>
      <TopBar wide={wide} />
      <main
        className={s.main}
        style={{
          paddingBottom: showTabBar
            ? 'calc(var(--tabbar-h) + env(safe-area-inset-bottom))'
            : !wide && selectMode
              ? 'calc(var(--selbar-h) + env(safe-area-inset-bottom))'
              : undefined,
        }}
      >
        {route.tab === 'library' && <LibraryTab />}
        <Suspense fallback={null}>
          {route.tab === 'memories' && <MemoriesTab />}
          {route.tab === 'places' && <PlacesTab />}
        </Suspense>
      </main>
      {showTabBar && <TabBar />}
      {selectMode && <SelectionBar wide={wide} />}
      {route.item && <Viewer itemId={route.item} wide={wide} />}
      {route.upload && <UploadSheet wide={wide} />}
      <Suspense fallback={null}>
        {route.memory && <MemoryPlayer memoryId={route.memory} onClose={closeOverlay} />}
      </Suspense>
      <ToastHost />
    </div>
  );
}
