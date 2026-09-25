import type Database from 'better-sqlite3';
import type { Config } from './config';
import type { EventHub } from './events';
import type { DiskGuard } from './disk';
import type { DerivationQueue } from './media/queue';
import type { PinThrottle } from './auth/throttle';
import type { ToolReport } from './media/tools';

export interface StoragePaths {
  root: string;
  originals: string;
  derived: string;
  incoming: string;
  trash: string;
  db: string;
  dbFile: string;
  secretFile: string;
}

/** Everything routes need, assembled once in app.ts. */
export interface AppCtx {
  config: Config;
  paths: StoragePaths;
  db: Database.Database;
  hub: EventHub;
  diskGuard: DiskGuard;
  queue: DerivationQueue;
  throttle: PinThrottle;
  secret: Buffer;
  pinVersion: string;
  tools: ToolReport;
  startedAt: number;
}
