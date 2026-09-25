/**
 * Server configuration, read once from the environment (or an explicit
 * override object for tests / dev variants).
 */
import path from 'node:path';
import { TRIP } from '@shared/trip';

export interface Config {
  port: number;
  host: string;
  storageDir: string;
  pin: string;
  albumTitle: string;
  photoConcurrency: number;
  videoConcurrency: number;
  logLevel: string;
  buildVersion: string;
  /** Set true only under vitest so the app doesn't try to listen twice / run purge timers loudly. */
  isTest: boolean;
}

export interface ConfigOverrides {
  port?: number;
  host?: string;
  storageDir?: string;
  pin?: string;
  albumTitle?: string;
  photoConcurrency?: number;
  videoConcurrency?: number;
  logLevel?: string;
  buildVersion?: string;
  isTest?: boolean;
}

export function loadConfig(overrides: ConfigOverrides = {}): Config {
  const env = process.env;
  return {
    port: overrides.port ?? Number(env.PORT ?? 8497),
    host: overrides.host ?? env.HOST ?? '0.0.0.0',
    storageDir: path.resolve(overrides.storageDir ?? env.STORAGE_DIR ?? './storage'),
    pin: overrides.pin ?? env.FAELLES_PIN ?? '1234',
    albumTitle: overrides.albumTitle ?? env.ALBUM_TITLE ?? TRIP.title,
    photoConcurrency: overrides.photoConcurrency ?? Number(env.PHOTO_CONCURRENCY ?? 4),
    videoConcurrency: overrides.videoConcurrency ?? Number(env.VIDEO_CONCURRENCY ?? 2),
    logLevel: overrides.logLevel ?? env.LOG_LEVEL ?? 'info',
    buildVersion: overrides.buildVersion ?? env.BUILD_VERSION ?? 'dev',
    isTest: overrides.isTest ?? env.VITEST === 'true',
  };
}

export function storagePaths(storageDir: string) {
  return {
    root: storageDir,
    originals: path.join(storageDir, 'originals'),
    derived: path.join(storageDir, 'derived'),
    incoming: path.join(storageDir, 'incoming'),
    trash: path.join(storageDir, 'trash'),
    db: path.join(storageDir, 'db'),
    dbFile: path.join(storageDir, 'db', 'faelles.sqlite'),
    secretFile: path.join(storageDir, 'secret.key'),
  };
}
