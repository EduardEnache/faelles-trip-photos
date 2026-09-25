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
import { api, originalDownloadUrl, zipDownloadUrl } from '@/lib/api';

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

/** Save/download originals. Reports through the toast store (B's full version). */
export async function saveItems(items: ItemDTO[], opts: { wide: boolean }): Promise<void> {
  if (!items.length) return;
  const method = saveMethodFor(items, opts.wide);
  if (method === 'single' || (method === 'share' && items.length === 1 && !canShareFiles())) {
    navigateDownload(originalDownloadUrl(items[0]!));
    return;
  }
  // Scaffold fallback: ZIP for everything else (B implements the share flow).
  const ticket = await api.createZip({ ids: items.map((i) => i.id) });
  navigateDownload(zipDownloadUrl(ticket.token));
}

/** Everything, as one ZIP. */
export async function downloadAll(): Promise<void> {
  const ticket = await api.createZip({ all: true });
  navigateDownload(zipDownloadUrl(ticket.token));
}
