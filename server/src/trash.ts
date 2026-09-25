/**
 * Periodic sweeps: purge trash older than LIMITS.trashDays, purge stale
 * incoming (tus) uploads older than LIMITS.staleUploadHours (PLAN.md §1.4/1.9).
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { LIMITS } from '@shared/api';
import { listTrashOlderThan, markPurged } from './db';
import { purgeStaleIncoming } from './upload/tus';

export async function sweepTrash(db: Database.Database): Promise<void> {
  const cutoff = new Date(Date.now() - LIMITS.trashDays * 24 * 3600_000).toISOString();
  for (const row of listTrashOlderThan(db, cutoff)) {
    await fsp.rm(path.dirname(row.stored_path), { recursive: true, force: true }).catch(() => {});
    markPurged(db, row.id);
  }
}

export function startSweeps(db: Database.Database, incomingDir: string): () => void {
  const run = () => {
    void sweepTrash(db);
    void purgeStaleIncoming(incomingDir);
  };
  run();
  const timer = setInterval(run, 3600_000);
  timer.unref?.();
  return () => clearInterval(timer);
}
