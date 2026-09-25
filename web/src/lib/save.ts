/**
 * FRONTEND owns this file — "get originals out" (the scaffold ships a
 * minimal working version with the FINAL signatures; C calls saveItems()).
 *
 * Policy (PLAN.md §Save):
 *  - Mobile (no WIDE, navigator.canShare({files}) true, ≤ LIMITS.shareMaxFiles
 *    and ≤ LIMITS.shareMaxBytes): two-step Web Share — fetch originals with real
 *    progress in the toast, then a "Save N to Photos" toast action (fresh user
 *    gesture) calls navigator.share({files}). Never claims an album name.
 *  - Otherwise: 1 item → original download; >1 → POST api/zip, then navigate to
 *    the zip URL (browser shows real progress; Content-Length is exact).
 */
import { LIMITS, type ItemDTO } from '@shared/api';
import { formatBytes, plural } from '@shared/format';
import { api, originalDownloadUrl, zipDownloadUrl } from '@/lib/api';
import { toast } from '@/state/toast';

export type SaveMethod = 'share' | 'zip' | 'single';

/** True when this device can hand files to the OS share sheet. */
export function canShareFiles(): boolean {
  try {
    const probe = new File([new Uint8Array(1)], 'probe.jpg', { type: 'image/jpeg' });
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/** Which method saveItems() would use for these items on this device. */
export function saveMethodFor(items: ItemDTO[], wide: boolean): SaveMethod {
  const bytes = items.reduce((a, i) => a + i.bytes, 0);
  if (!wide && canShareFiles() && items.length <= LIMITS.shareMaxFiles && bytes <= LIMITS.shareMaxBytes) return 'share';
  return items.length === 1 ? 'single' : 'zip';
}

function navigateDownload(href: string) {
  const a = document.createElement('a');
  a.href = href;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Save/download originals, reported honestly through the toast store:
 *  - single: one item, no share/zip needed → direct attachment download.
 *  - zip: server streams an exact Content-Length; the browser's own download
 *    UI shows real progress, so the toast just confirms it started.
 *  - share: fetch originals with REAL byte progress in the toast, then a
 *    "Save" action (a fresh tap, required by iOS) hands them to the OS share
 *    sheet. Never claims an album name a web app cannot set.
 */
export async function saveItems(items: ItemDTO[], opts: { wide: boolean }): Promise<void> {
  if (!items.length) return;
  const method = saveMethodFor(items, opts.wide);

  if (method === 'single') {
    const item = items[0]!;
    navigateDownload(originalDownloadUrl(item));
    toast.show({ id: 'save', title: `Downloading ${item.fileName}`, sub: formatBytes(item.bytes) });
    return;
  }

  if (method === 'zip') {
    const ticket = await api.createZip({ ids: items.map((i) => i.id) });
    navigateDownload(zipDownloadUrl(ticket.token));
    toast.show({
      id: 'save',
      title: 'Download started',
      sub: `${plural(ticket.count, 'original')} · ${formatBytes(ticket.bytes)}`,
    });
    return;
  }

  // method === 'share'
  const id = 'save-share';
  const total = items.reduce((a, i) => a + i.bytes, 0);
  toast.show({ id, title: `Preparing ${plural(items.length, 'original')}`, sub: formatBytes(total), progress: 0 });

  const files: File[] = [];
  let received = 0;
  try {
    for (const item of items) {
      const res = await fetch(originalDownloadUrl(item), { credentials: 'same-origin' });
      if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`);
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        toast.update(id, { progress: total ? received / total : 0 });
      }
      files.push(new File(chunks as BlobPart[], item.fileName, { type: item.mime, lastModified: Date.parse(item.takenAt) }));
    }
  } catch {
    toast.update(id, {
      title: 'Could not prepare the files',
      sub: 'Check your connection and try again.',
      progress: null,
      error: true,
      durationMs: 4000,
    });
    return;
  }

  toast.update(id, {
    title: `${plural(files.length, 'original')} ready`,
    sub: formatBytes(total),
    progress: 1,
    done: true,
    durationMs: 0,
    action: {
      label: 'Save',
      onAction: () => {
        navigator.share({ files }).catch(() => {
          /* user cancelled the share sheet, or it's unsupported after all */
        });
        toast.dismiss(id);
      },
    },
  });
}

/** Everything, as one ZIP. Honest toast: real count/size, no fake percentage. */
export async function downloadAll(): Promise<void> {
  const ticket = await api.createZip({ all: true });
  navigateDownload(zipDownloadUrl(ticket.token));
  toast.show({
    id: 'save',
    title: 'Download started',
    sub: `${plural(ticket.count, 'original')} · ${formatBytes(ticket.bytes)}`,
  });
}
