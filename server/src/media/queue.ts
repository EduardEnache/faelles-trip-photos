/**
 * In-process, DB-durable derivation queue (PLAN.md §1.6): two lanes (photo,
 * video), bounded concurrency, one retry then `failed`. On boot every item
 * still `processing` is re-enqueued.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { ItemKind } from '@shared/api';
import { getItem, getItemRow, listProcessingItems, updateDerived } from '../db';
import type { EventHub } from '../events';
import { generatePhotoDerivatives, generatePosterDerivatives } from './vips';
import { extractPosterFrame, probeVideo, transcodePreview } from './ffmpeg';
import type { ToolReport } from './tools';

const PHOTO_TIMEOUT_MS = 120_000;
const VIDEO_TIMEOUT_MS = 30 * 60_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

class Lane {
  private queue: string[] = [];
  private inFlight = new Set<string>();
  private queued = new Set<string>();
  private running = 0;

  constructor(
    private readonly concurrency: number,
    private readonly process: (itemId: string) => Promise<void>,
  ) {}

  enqueue(itemId: string): void {
    if (this.inFlight.has(itemId) || this.queued.has(itemId)) return;
    this.queue.push(itemId);
    this.queued.add(itemId);
    this.pump();
  }

  private pump(): void {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const id = this.queue.shift()!;
      this.queued.delete(id);
      this.inFlight.add(id);
      this.running++;
      this.process(id)
        .catch(() => {
          /* process() itself never throws (it handles retries/failure internally) */
        })
        .finally(() => {
          this.inFlight.delete(id);
          this.running--;
          this.pump();
        });
    }
  }
}

export interface DerivationQueueConfig {
  photoConcurrency: number;
  videoConcurrency: number;
  derivedDir: string;
}

export class DerivationQueue {
  private photoLane: Lane;
  private videoLane: Lane;
  private attempts = new Map<string, number>();

  constructor(
    private readonly db: Database.Database,
    private readonly cfg: DerivationQueueConfig,
    private readonly hub: EventHub,
    private readonly tools: ToolReport,
  ) {
    this.photoLane = new Lane(cfg.photoConcurrency, (id) => this.runWithRetry(id, 'photo'));
    this.videoLane = new Lane(cfg.videoConcurrency, (id) => this.runWithRetry(id, 'video'));
  }

  /** Re-enqueues anything left `processing` from a previous run (crash/restart durability). */
  resumeFromDb(): void {
    for (const row of listProcessingItems(this.db)) {
      this.enqueue(row.id, row.kind);
    }
  }

  enqueue(itemId: string, kind: ItemKind): void {
    if (kind === 'photo') this.photoLane.enqueue(itemId);
    else this.videoLane.enqueue(itemId);
  }

  private async runWithRetry(itemId: string, kind: ItemKind): Promise<void> {
    const attempt = (this.attempts.get(itemId) ?? 0) + 1;
    this.attempts.set(itemId, attempt);
    try {
      const timeout = kind === 'photo' ? PHOTO_TIMEOUT_MS : VIDEO_TIMEOUT_MS;
      await withTimeout(this.process(itemId, kind), timeout, kind);
      this.attempts.delete(itemId);
    } catch (err) {
      if (attempt < 2) {
        this.enqueue(itemId, kind);
        return;
      }
      this.attempts.delete(itemId);
      const message = err instanceof Error ? err.message : String(err);
      updateDerived(this.db, itemId, { status: 'failed', error: shortError(kind, message) });
      this.broadcastUpdate(itemId);
    }
  }

  private broadcastUpdate(itemId: string): void {
    const item = getItem(this.db, itemId);
    if (item) this.hub.broadcast({ type: 'item.updated', item });
  }

  private async process(itemId: string, kind: ItemKind): Promise<void> {
    const row = getItemRow(this.db, itemId);
    if (!row || row.deleted_at) return;
    const derivedDir = path.join(this.cfg.derivedDir, itemId);
    await fs.mkdir(derivedDir, { recursive: true });

    if (kind === 'photo') {
      if (!this.tools.vips) {
        updateDerived(this.db, itemId, { status: 'failed', error: 'Image tools unavailable on this server.' });
        this.broadcastUpdate(itemId);
        return;
      }
      const result = await generatePhotoDerivatives(row.stored_path, derivedDir);
      if (result.ok) {
        updateDerived(this.db, itemId, { hasThumb: true, hasDisplay: true, tone: result.tone, status: 'ready' });
      } else {
        updateDerived(this.db, itemId, { status: 'failed', error: result.error });
      }
      this.broadcastUpdate(itemId);
      return;
    }

    // video
    if (!this.tools.ffmpeg) {
      updateDerived(this.db, itemId, { status: 'failed', error: 'Video tools unavailable on this server.' });
      this.broadcastUpdate(itemId);
      return;
    }

    let probe;
    try {
      probe = await probeVideo(row.stored_path);
    } catch {
      updateDerived(this.db, itemId, { status: 'failed', error: "Couldn't read this video. The original is safe." });
      this.broadcastUpdate(itemId);
      return;
    }
    updateDerived(this.db, itemId, { width: probe.width, height: probe.height, durationMs: probe.durationMs });

    const posterSrc = path.join(derivedDir, 'poster-src.jpg');
    const atMs = Math.min(1000, (probe.durationMs ?? 2000) / 2);
    try {
      await extractPosterFrame(row.stored_path, posterSrc, atMs);
      const posterResult = await generatePosterDerivatives(posterSrc, derivedDir);
      if (!posterResult.ok) throw new Error(posterResult.error ?? 'poster failed');
      updateDerived(this.db, itemId, { hasThumb: true, hasDisplay: true, tone: posterResult.tone });
      this.broadcastUpdate(itemId); // tile can appear now, even before the preview finishes
    } catch {
      updateDerived(this.db, itemId, { status: 'failed', error: "Couldn't make a preview. The original is safe." });
      this.broadcastUpdate(itemId);
      return;
    } finally {
      await fs.rm(posterSrc, { force: true }).catch(() => {});
    }

    const previewTmp = path.join(derivedDir, 'preview.tmp.mp4');
    const previewFinal = path.join(derivedDir, 'preview.mp4');
    try {
      await transcodePreview(row.stored_path, previewTmp, { isHdr: probe.isHdr, zscaleAvailable: this.tools.zscale });
      await fs.rename(previewTmp, previewFinal);
      updateDerived(this.db, itemId, { hasPreview: true, status: 'ready' });
    } catch {
      await fs.rm(previewTmp, { force: true }).catch(() => {});
      updateDerived(this.db, itemId, { status: 'failed', error: "Couldn't make a preview. The original is safe." });
    }
    this.broadcastUpdate(itemId);
  }
}

function shortError(kind: ItemKind, message: string): string {
  if (/timed out/i.test(message)) {
    return kind === 'photo' ? "Couldn't process this photo in time. The original is safe." : "Couldn't process this video in time. The original is safe.";
  }
  return kind === 'photo' ? "Couldn't make a preview. The original is safe." : "Couldn't make a preview. The original is safe.";
}
