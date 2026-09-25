/**
 * Streamed ZIP of originals with an exact Content-Length (PLAN.md §1.8).
 * STORE (no compression) means yazl can compute the final size before any
 * byte is sent, so the browser gets real progress on the download.
 */
import path from 'node:path';
import { ZipFile } from 'yazl';
import { ulid } from 'ulid';
import { LIMITS, type ItemDTO } from '@shared/api';
import { TRIP, zipFolderName } from '@shared/trip';

export interface ZipItemInput {
  id: string;
  fileName: string;
  day: ItemDTO['day'];
  takenAt: string;
  storedPath: string;
}

/** Builds unique in-zip paths: '<day folder>/<fileName>', duplicates get ' (2)'. */
export function uniqueEntryNames(items: readonly ZipItemInput[]): Map<string, string> {
  const usedPerFolder = new Map<string, Set<string>>();
  const result = new Map<string, string>();
  for (const item of items) {
    const folder = zipFolderName(item.day);
    let used = usedPerFolder.get(folder);
    if (!used) {
      used = new Set();
      usedPerFolder.set(folder, used);
    }
    let name = item.fileName;
    if (used.has(name)) {
      const parsed = path.parse(item.fileName);
      let n = 2;
      let candidate = `${parsed.name} (${n})${parsed.ext}`;
      while (used.has(candidate)) {
        n++;
        candidate = `${parsed.name} (${n})${parsed.ext}`;
      }
      name = candidate;
    }
    used.add(name);
    result.set(item.id, `${folder}/${name}`);
  }
  return result;
}

export interface BuiltZip {
  zipfile: ZipFile;
  bytes: number;
}

/** Adds every item as a STORE entry and resolves once yazl knows the exact final size. */
export function buildZip(items: readonly ZipItemInput[]): Promise<BuiltZip> {
  const zipfile = new ZipFile();
  const names = uniqueEntryNames(items);
  for (const item of items) {
    zipfile.addFile(item.storedPath, names.get(item.id)!, {
      compress: false,
      mtime: new Date(item.takenAt),
    });
  }
  return new Promise((resolve) => {
    // yazl's .d.ts under-types the callback as `() => void`; at runtime it is
    // invoked with the exact final size once every entry's size is known
    // (guaranteed here since every entry is STORE with a real file behind it).
    type EndFn = (options: { forceZip64Format?: boolean }, cb: (bytes: number) => void) => void;
    (zipfile.end as unknown as EndFn)({ forceZip64Format: false }, (bytes) => {
      resolve({ zipfile, bytes });
    });
  });
}

export function zipFileName(all: boolean, count: number): string {
  return all ? `${TRIP.slug}-all.zip` : `${TRIP.slug}-selection-${count}.zip`;
}

interface Ticket {
  zipfile: ZipFile;
  fileName: string;
  bytes: number;
  expiresAt: number;
  consumed: boolean;
}

/** Single-use, time-limited zip tickets: POST creates one, GET consumes it once. */
export class ZipTicketStore {
  private tickets = new Map<string, Ticket>();

  create(zipfile: ZipFile, fileName: string, bytes: number): { token: string; expiresAt: string } {
    const token = ulid();
    const expiresAtMs = Date.now() + LIMITS.zipTicketMinutes * 60_000;
    this.tickets.set(token, { zipfile, fileName, bytes, expiresAt: expiresAtMs, consumed: false });
    return { token, expiresAt: new Date(expiresAtMs).toISOString() };
  }

  /** Returns the ticket and marks it consumed, or null if unknown/expired/already used. */
  take(token: string): Ticket | null {
    const t = this.tickets.get(token);
    if (!t) return null;
    if (t.consumed || Date.now() > t.expiresAt) {
      this.tickets.delete(token);
      try {
        (t.zipfile.outputStream as unknown as { destroy: () => void }).destroy();
      } catch {
        /* already gone */
      }
      return null;
    }
    t.consumed = true;
    this.tickets.delete(token);
    return t;
  }

  sweepExpired(): void {
    const now = Date.now();
    for (const [token, t] of this.tickets) {
      if (now > t.expiresAt) {
        this.tickets.delete(token);
        try {
          (t.zipfile.outputStream as unknown as { destroy: () => void }).destroy();
        } catch {
          /* already gone */
        }
      }
    }
  }
}
