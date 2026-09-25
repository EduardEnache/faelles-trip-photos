/**
 * Disk-free guard (PLAN.md §1.9). Polls storageDir's filesystem, broadcasts
 * `disk` when either flag flips, and is also checked synchronously at
 * upload creation.
 */
import fs from 'node:fs/promises';
import { LIMITS, type DiskDTO } from '@shared/api';
import type { EventHub } from './events';

export class DiskGuard {
  private current: DiskDTO = { freeBytes: Infinity, totalBytes: Infinity, lowSpace: false, uploadsBlocked: false };
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly storageDir: string,
    private readonly hub: EventHub,
  ) {}

  get(): DiskDTO {
    return this.current;
  }

  async refresh(): Promise<DiskDTO> {
    let freeBytes = Infinity;
    let totalBytes = Infinity;
    try {
      const s = await fs.statfs(this.storageDir);
      freeBytes = s.bavail * s.bsize;
      totalBytes = s.blocks * s.bsize;
    } catch {
      // statfs unavailable (unlikely on Linux) — fail open, never crash on it
    }
    const next: DiskDTO = {
      freeBytes,
      totalBytes,
      lowSpace: freeBytes < LIMITS.lowSpaceBytes,
      uploadsBlocked: freeBytes < LIMITS.minFreeBytes,
    };
    const flipped =
      next.lowSpace !== this.current.lowSpace || next.uploadsBlocked !== this.current.uploadsBlocked;
    this.current = next;
    if (flipped) this.hub.broadcast({ type: 'disk', disk: next });
    return next;
  }

  /** Refuse an upload of `size` bytes if free space (minus this upload) would drop below the floor. */
  async wouldBlock(size: number): Promise<boolean> {
    const d = await this.refresh();
    return d.freeBytes - size < LIMITS.minFreeBytes;
  }

  start(intervalMs = 60_000): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
