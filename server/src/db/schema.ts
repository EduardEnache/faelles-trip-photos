import type Database from 'better-sqlite3';

const SCHEMA_VERSION = 1;

export function migrate(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, error TEXT,
      uploader TEXT NOT NULL, uploaded_at TEXT NOT NULL,
      file_name TEXT NOT NULL, stored_path TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      taken_at TEXT NOT NULL, date_source TEXT NOT NULL,
      width INTEGER, height INTEGER, duration_ms INTEGER, lat REAL, lon REAL,
      camera TEXT, lens TEXT, f_number REAL, exposure TEXT, iso INTEGER, tone TEXT,
      has_thumb INTEGER NOT NULL DEFAULT 0, has_display INTEGER NOT NULL DEFAULT 0,
      has_preview INTEGER NOT NULL DEFAULT 0, rev INTEGER NOT NULL DEFAULT 0,
      highlighted_by TEXT, deleted_at TEXT, purged_at TEXT
    );
    CREATE INDEX IF NOT EXISTS items_taken ON items(taken_at, id) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS items_sha ON items(sha256) WHERE deleted_at IS NULL;
    CREATE TABLE IF NOT EXISTS hearts (
      item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      person TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (item_id, person)
    );
    CREATE TABLE IF NOT EXISTS captions (
      day TEXT PRIMARY KEY, text TEXT NOT NULL, person TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS uploads (
      upload_id TEXT PRIMARY KEY, item_id TEXT NOT NULL, duplicate INTEGER NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version') as
    | { value: string }
    | undefined;
  if (!row) {
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('schema_version', String(SCHEMA_VERSION));
  }
}
