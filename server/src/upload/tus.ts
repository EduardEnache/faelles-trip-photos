/**
 * tus 1.0 resumable uploads (PLAN.md §1.4). Wraps @tus/server + @tus/file-store,
 * doing auth, validation, dedupe, exif and item creation in the hooks.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { Server as TusServer } from '@tus/server';
import { FileStore } from '@tus/file-store';
import type { Upload } from '@tus/utils';
import { ulid } from 'ulid';
import type Database from 'better-sqlite3';
import {
  isAcceptedFile,
  kindOf,
  LIMITS,
  UPLOAD_HEADERS,
  type ApiError,
} from '@shared/api';
import { isPersonId, type PersonId } from '@shared/trip';
import { readSessionFromCookieHeader, type SessionPayload } from '../auth/session';
import { findBySha, getItem, insertItem, recordUpload } from '../db';
import type { EventHub } from '../events';
import type { DiskGuard } from '../disk';
import type { DerivationQueue } from '../media/queue';
import { readExifTags } from '../media/exif';
import { resolveCamera, resolveCapture, resolveDimensions, resolveGps, resolveLens } from '../media/capture';
import { moveFile } from '../util/fsmove';

export interface TusDeps {
  db: Database.Database;
  incomingDir: string;
  originalsDir: string;
  secret: Buffer;
  pinVersion: string;
  hub: EventHub;
  diskGuard: DiskGuard;
  queue: DerivationQueue;
}

function tusError(status_code: number, err: ApiError): { status_code: number; body: string } {
  return { status_code, body: JSON.stringify(err) };
}

function sessionFromReq(req: Request, deps: TusDeps): SessionPayload {
  const session = readSessionFromCookieHeader(req.headers.get('cookie'), deps.secret, deps.pinVersion);
  if (!session) {
    throw tusError(401, { error: 'unauthenticated', message: 'Sign in with the PIN first.' });
  }
  if (!session.person) {
    throw tusError(409, { error: 'no_person', message: 'Choose who you are before uploading.' });
  }
  return session;
}

/** basename, NFC, disallowed chars → '_', max 120 chars. */
export function safeOriginalName(name: string): string {
  const base = path.basename(name).normalize('NFC');
  const cleaned = base.replace(/[^\p{L}\p{N}._ -]/gu, '_');
  const trimmed = cleaned.slice(0, 120).trim();
  return trimmed || 'file';
}

async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const rs = fs.createReadStream(filePath);
    rs.on('error', reject);
    rs.on('data', (chunk) => hash.update(chunk));
    rs.on('end', () => resolve(hash.digest('hex')));
  });
}

async function removeIncomingArtifacts(incomingDir: string, id: string, includeData: boolean): Promise<void> {
  const jobs: Promise<void>[] = [fsp.rm(path.join(incomingDir, `${id}.json`), { force: true })];
  if (includeData) jobs.push(fsp.rm(path.join(incomingDir, id), { force: true }));
  await Promise.all(jobs.map((p) => p.catch(() => {})));
}

async function onUploadCreate(req: Request, upload: Upload, deps: TusDeps) {
  const session = sessionFromReq(req, deps);
  const filename = upload.metadata?.filename ?? '';
  const filetype = upload.metadata?.filetype ?? '';
  if (!filename || !isAcceptedFile(filename, filetype)) {
    throw tusError(415, { error: 'unsupported_type', message: "That file type isn't supported." });
  }
  if (upload.size != null && upload.size > LIMITS.maxUploadBytes) {
    throw tusError(413, { error: 'too_large', message: 'That file is larger than the 10 GiB limit.' });
  }
  if (upload.size != null) {
    const blocked = await deps.diskGuard.wouldBlock(upload.size);
    if (blocked) {
      throw tusError(507, { error: 'insufficient_storage', message: 'Not enough free space on the server right now.' });
    }
  }
  return { metadata: { ...(upload.metadata ?? {}), person: session.person! } };
}

async function onUploadFinish(
  _req: Request,
  upload: Upload,
  deps: TusDeps,
): Promise<{ headers?: Record<string, string> }> {
  const person = upload.metadata?.person as PersonId | undefined;
  if (!person || !isPersonId(person)) {
    throw tusError(409, { error: 'no_person', message: 'Choose who you are before uploading.' });
  }
  const filename = upload.metadata?.filename || 'file';
  const mime = upload.metadata?.filetype || '';
  const lastModifiedRaw = upload.metadata?.lastModified ?? null;
  const lastModifiedMs =
    lastModifiedRaw != null && lastModifiedRaw !== '' && !Number.isNaN(Number(lastModifiedRaw))
      ? Number(lastModifiedRaw)
      : null;

  const sourcePath = path.join(deps.incomingDir, upload.id);
  const sha256 = await sha256File(sourcePath);

  const existing = findBySha(deps.db, sha256);
  if (existing) {
    await removeIncomingArtifacts(deps.incomingDir, upload.id, true);
    recordUpload(deps.db, upload.id, existing.id, true);
    return { headers: { [UPLOAD_HEADERS.itemId]: existing.id, [UPLOAD_HEADERS.duplicate]: '1' } };
  }

  const kind = kindOf(filename, mime);
  const tags = await readExifTags(sourcePath);
  const receivedAtMs = Date.now();
  const capture = resolveCapture(tags, { kind, lastModifiedMs, receivedAtMs });
  const gps = resolveGps(tags);
  const camera = resolveCamera(tags, kind);
  const lensInfo = resolveLens(tags);
  const dims = kind === 'photo' ? resolveDimensions(tags) : { width: null, height: null };

  const id = ulid();
  const safeName = safeOriginalName(filename);
  const destDir = path.join(deps.originalsDir, person);
  await fsp.mkdir(destDir, { recursive: true });
  const destPath = path.join(destDir, `${id}-${safeName}`);
  await moveFile(sourcePath, destPath);
  await removeIncomingArtifacts(deps.incomingDir, upload.id, false);

  const bytes = upload.size ?? upload.offset;

  insertItem(deps.db, {
    id,
    kind,
    uploader: person,
    uploadedAt: new Date(receivedAtMs).toISOString(),
    fileName: filename,
    storedPath: destPath,
    mime: mime || (kind === 'video' ? 'video/mp4' : 'image/jpeg'),
    bytes,
    sha256,
    takenAt: capture.takenAt,
    dateSource: capture.dateSource,
    lat: gps.lat,
    lon: gps.lon,
    camera,
    lens: lensInfo.lens,
    fNumber: lensInfo.fNumber,
    exposure: lensInfo.exposure,
    iso: lensInfo.iso,
    width: dims.width,
    height: dims.height,
    durationMs: null,
  });
  recordUpload(deps.db, upload.id, id, false);
  deps.queue.enqueue(id, kind);
  const item = getItem(deps.db, id)!;
  deps.hub.broadcast({ type: 'item.added', item });

  return { headers: { [UPLOAD_HEADERS.itemId]: id, [UPLOAD_HEADERS.duplicate]: '0' } };
}

export const TUS_PATH = '/api/uploads';

export function createTusServer(deps: TusDeps): TusServer {
  const fileStore = new FileStore({ directory: deps.incomingDir });
  return new TusServer({
    path: TUS_PATH,
    datastore: fileStore,
    relativeLocation: true,
    // A bare id (no leading slash) so it resolves against the CLIENT'S
    // request URL (which may carry the /photos prefix) rather than against
    // the server's own `path` option, which never does.
    generateUrl: (_req, { id }) => id,
    onIncomingRequest: async (req) => {
      sessionFromReq(req, deps);
    },
    onUploadCreate: (req, upload) => onUploadCreate(req, upload, deps),
    onUploadFinish: (req, upload) => onUploadFinish(req, upload, deps),
  });
}

/** Purges incoming uploads older than LIMITS.staleUploadHours (PLAN.md §1.4 step 5). */
export async function purgeStaleIncoming(incomingDir: string): Promise<void> {
  const cutoff = Date.now() - LIMITS.staleUploadHours * 3600_000;
  let names: string[];
  try {
    names = await fsp.readdir(incomingDir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const full = path.join(incomingDir, name);
    try {
      const st = await fsp.stat(full);
      if (st.mtimeMs < cutoff) {
        const id = name.slice(0, -'.json'.length);
        await removeIncomingArtifacts(incomingDir, id, true);
      }
    } catch {
      /* file removed concurrently, ignore */
    }
  }
}
