import Database from 'better-sqlite3';
import { dayOf } from '@shared/trip';
import type { CaptionDTO, DateSource, ItemDTO, ItemKind, ItemStatus, PersonId } from '@shared/api';
import { migrate } from './schema';

export interface ItemRow {
  id: string;
  kind: ItemKind;
  status: ItemStatus;
  error: string | null;
  uploader: PersonId;
  uploaded_at: string;
  file_name: string;
  stored_path: string;
  mime: string;
  bytes: number;
  sha256: string;
  taken_at: string;
  date_source: DateSource;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  lat: number | null;
  lon: number | null;
  camera: string | null;
  lens: string | null;
  f_number: number | null;
  exposure: string | null;
  iso: number | null;
  tone: string | null;
  has_thumb: number;
  has_display: number;
  has_preview: number;
  rev: number;
  highlighted_by: PersonId | null;
  deleted_at: string | null;
  purged_at: string | null;
}

export function openDb(dbFile: string): Database.Database {
  const db = new Database(dbFile);
  migrate(db);
  return db;
}

export function heartsFor(db: Database.Database, itemId: string): PersonId[] {
  const rows = db.prepare('SELECT person FROM hearts WHERE item_id = ? ORDER BY created_at ASC').all(itemId) as {
    person: PersonId;
  }[];
  return rows.map((r) => r.person);
}

export function rowToItem(db: Database.Database, row: ItemRow): ItemDTO {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    error: row.error,
    media: {
      thumb: !!row.has_thumb,
      display: !!row.has_display,
      preview: !!row.has_preview,
    },
    rev: row.rev,
    uploader: row.uploader,
    uploadedAt: row.uploaded_at,
    fileName: row.file_name,
    mime: row.mime,
    bytes: row.bytes,
    takenAt: row.taken_at,
    dateSource: row.date_source,
    day: dayOf(row.taken_at),
    width: row.width,
    height: row.height,
    durationMs: row.duration_ms,
    lat: row.lat,
    lon: row.lon,
    camera: row.camera,
    lens: row.lens,
    fNumber: row.f_number,
    exposure: row.exposure,
    iso: row.iso,
    tone: row.tone,
    hearts: heartsFor(db, row.id),
    highlighted: row.highlighted_by != null,
    highlightedBy: row.highlighted_by,
  };
}

export function getItemRow(db: Database.Database, id: string): ItemRow | undefined {
  return db.prepare('SELECT * FROM items WHERE id = ?').get(id) as ItemRow | undefined;
}

export function getItem(db: Database.Database, id: string): ItemDTO | undefined {
  const row = getItemRow(db, id);
  return row ? rowToItem(db, row) : undefined;
}

export function listActiveItems(db: Database.Database): ItemDTO[] {
  const rows = db
    .prepare('SELECT * FROM items WHERE deleted_at IS NULL ORDER BY taken_at ASC, id ASC')
    .all() as ItemRow[];
  return rows.map((r) => rowToItem(db, r));
}

export function listProcessingItems(db: Database.Database): ItemRow[] {
  return db.prepare("SELECT * FROM items WHERE status = 'processing' AND deleted_at IS NULL").all() as ItemRow[];
}

export interface NewItemFields {
  id: string;
  kind: ItemKind;
  uploader: PersonId;
  uploadedAt: string;
  fileName: string;
  storedPath: string;
  mime: string;
  bytes: number;
  sha256: string;
  takenAt: string;
  dateSource: DateSource;
  lat: number | null;
  lon: number | null;
  camera: string | null;
  lens: string | null;
  fNumber: number | null;
  exposure: string | null;
  iso: number | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
}

export function insertItem(db: Database.Database, f: NewItemFields): void {
  db.prepare(
    `INSERT INTO items (
      id, kind, status, error, uploader, uploaded_at, file_name, stored_path, mime, bytes, sha256,
      taken_at, date_source, width, height, duration_ms, lat, lon, camera, lens, f_number, exposure, iso,
      tone, has_thumb, has_display, has_preview, rev, highlighted_by, deleted_at
    ) VALUES (@id, @kind, 'processing', NULL, @uploader, @uploadedAt, @fileName, @storedPath, @mime, @bytes,
      @sha256, @takenAt, @dateSource, @width, @height, @durationMs, @lat, @lon, @camera, @lens, @fNumber,
      @exposure, @iso, NULL, 0, 0, 0, 0, NULL, NULL)`,
  ).run({
    ...f,
    width: f.width ?? null,
    height: f.height ?? null,
    durationMs: f.durationMs ?? null,
  });
}

export function findBySha(db: Database.Database, sha256: string): ItemRow | undefined {
  return db.prepare('SELECT * FROM items WHERE sha256 = ? AND deleted_at IS NULL LIMIT 1').get(sha256) as
    | ItemRow
    | undefined;
}

export function findByIdIncludingDeleted(db: Database.Database, id: string): ItemRow | undefined {
  return db.prepare('SELECT * FROM items WHERE id = ?').get(id) as ItemRow | undefined;
}

export interface DerivedUpdate {
  hasThumb?: boolean;
  hasDisplay?: boolean;
  hasPreview?: boolean;
  tone?: string | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  status?: ItemStatus;
  error?: string | null;
}

export function updateDerived(db: Database.Database, id: string, u: DerivedUpdate): void {
  const sets: string[] = ['rev = rev + 1'];
  const params: Record<string, unknown> = { id };
  if (u.hasThumb !== undefined) {
    sets.push('has_thumb = @hasThumb');
    params.hasThumb = u.hasThumb ? 1 : 0;
  }
  if (u.hasDisplay !== undefined) {
    sets.push('has_display = @hasDisplay');
    params.hasDisplay = u.hasDisplay ? 1 : 0;
  }
  if (u.hasPreview !== undefined) {
    sets.push('has_preview = @hasPreview');
    params.hasPreview = u.hasPreview ? 1 : 0;
  }
  if (u.tone !== undefined) {
    sets.push('tone = @tone');
    params.tone = u.tone;
  }
  if (u.width !== undefined) {
    sets.push('width = @width');
    params.width = u.width;
  }
  if (u.height !== undefined) {
    sets.push('height = @height');
    params.height = u.height;
  }
  if (u.durationMs !== undefined) {
    sets.push('duration_ms = @durationMs');
    params.durationMs = u.durationMs;
  }
  if (u.status !== undefined) {
    sets.push('status = @status');
    params.status = u.status;
  }
  if (u.error !== undefined) {
    sets.push('error = @error');
    params.error = u.error;
  }
  db.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = @id`).run(params);
}

export function setHeart(db: Database.Database, itemId: string, person: PersonId, on: boolean): void {
  if (on) {
    db.prepare('INSERT OR IGNORE INTO hearts (item_id, person, created_at) VALUES (?, ?, ?)').run(
      itemId,
      person,
      new Date().toISOString(),
    );
  } else {
    db.prepare('DELETE FROM hearts WHERE item_id = ? AND person = ?').run(itemId, person);
  }
  db.prepare('UPDATE items SET rev = rev + 1 WHERE id = ?').run(itemId);
}

export function setHighlight(db: Database.Database, itemId: string, person: PersonId, on: boolean): void {
  db.prepare('UPDATE items SET highlighted_by = ?, rev = rev + 1 WHERE id = ?').run(on ? person : null, itemId);
}

export function softDelete(db: Database.Database, itemId: string): void {
  db.prepare('UPDATE items SET deleted_at = ?, rev = rev + 1 WHERE id = ?').run(new Date().toISOString(), itemId);
}

export function restore(db: Database.Database, itemId: string): void {
  db.prepare('UPDATE items SET deleted_at = NULL, rev = rev + 1 WHERE id = ?').run(itemId);
}

export function updateStoredPath(db: Database.Database, itemId: string, storedPath: string): void {
  db.prepare('UPDATE items SET stored_path = ? WHERE id = ?').run(storedPath, itemId);
}

/** Move to trash: sets deleted_at + the (already-moved-on-disk) new stored_path in one bump. */
export function moveToTrash(db: Database.Database, itemId: string, newStoredPath: string): void {
  db.prepare('UPDATE items SET deleted_at = ?, stored_path = ?, rev = rev + 1 WHERE id = ?').run(
    new Date().toISOString(),
    newStoredPath,
    itemId,
  );
}

/** Restore from trash: clears deleted_at + sets the restored stored_path in one bump. */
export function restoreFromTrash(db: Database.Database, itemId: string, newStoredPath: string): void {
  db.prepare('UPDATE items SET deleted_at = NULL, stored_path = ?, rev = rev + 1 WHERE id = ?').run(
    newStoredPath,
    itemId,
  );
}

export function markPurged(db: Database.Database, itemId: string): void {
  db.prepare('UPDATE items SET purged_at = ? WHERE id = ?').run(new Date().toISOString(), itemId);
}

/** Trashed, not yet purged, older than `cutoffIso` — for the trash-retention sweep. */
export function listTrashOlderThan(db: Database.Database, cutoffIso: string): ItemRow[] {
  return db
    .prepare('SELECT * FROM items WHERE deleted_at IS NOT NULL AND purged_at IS NULL AND deleted_at < ?')
    .all(cutoffIso) as ItemRow[];
}

// ── captions ──────────────────────────────────────────────────────

export function getCaption(db: Database.Database, day: string): CaptionDTO | undefined {
  const row = db.prepare('SELECT * FROM captions WHERE day = ?').get(day) as
    | { day: string; text: string; person: PersonId; updated_at: string }
    | undefined;
  return row ? { day: row.day as CaptionDTO['day'], text: row.text, by: row.person, updatedAt: row.updated_at } : undefined;
}

export function listCaptions(db: Database.Database): CaptionDTO[] {
  const rows = db.prepare('SELECT * FROM captions').all() as {
    day: string;
    text: string;
    person: PersonId;
    updated_at: string;
  }[];
  return rows.map((r) => ({ day: r.day as CaptionDTO['day'], text: r.text, by: r.person, updatedAt: r.updated_at }));
}

export function setCaption(db: Database.Database, day: string, text: string, person: PersonId): CaptionDTO {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO captions (day, text, person, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET text = excluded.text, person = excluded.person, updated_at = excluded.updated_at`,
  ).run(day, text, person, now);
  return { day: day as CaptionDTO['day'], text, by: person, updatedAt: now };
}

export function deleteCaption(db: Database.Database, day: string): void {
  db.prepare('DELETE FROM captions WHERE day = ?').run(day);
}

// ── uploads (tus upload id → item id, for the upload-results fallback) ──

export function recordUpload(db: Database.Database, uploadId: string, itemId: string, duplicate: boolean): void {
  db.prepare(
    'INSERT OR REPLACE INTO uploads (upload_id, item_id, duplicate, created_at) VALUES (?, ?, ?, ?)',
  ).run(uploadId, itemId, duplicate ? 1 : 0, new Date().toISOString());
}

export function getUploadResult(
  db: Database.Database,
  uploadId: string,
): { itemId: string; duplicate: boolean } | undefined {
  const row = db.prepare('SELECT * FROM uploads WHERE upload_id = ?').get(uploadId) as
    | { upload_id: string; item_id: string; duplicate: number }
    | undefined;
  return row ? { itemId: row.item_id, duplicate: !!row.duplicate } : undefined;
}
