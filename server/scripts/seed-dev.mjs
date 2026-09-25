#!/usr/bin/env node
/**
 * Seeds the dev backend (default http://127.0.0.1:8498) with ~30 generated
 * photos + a few video clips across the trip's people/POIs/days, uploaded
 * through the REAL tus flow (server-side EXIF/derivatives run exactly as
 * they would for a real upload), plus a few hearts/highlights/captions.
 *
 * Dev storage only — never point this at the production container.
 *
 * Usage:
 *   node scripts/seed-dev.mjs
 *   FAELLES_SEED_TARGET=http://127.0.0.1:8498 FAELLES_PIN=1234 node scripts/seed-dev.mjs
 *
 * Generates its raw media (server/scripts/.seed-assets/, gitignored) via
 * make-seed-assets.sh on first run (needs Docker if vips/ffmpeg/exiftool
 * aren't on PATH — same pattern as make-fixtures.sh).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TARGET = process.env.FAELLES_SEED_TARGET ?? 'http://127.0.0.1:8498';
const PIN = process.env.FAELLES_PIN ?? '1234';
const ASSETS_DIR = path.join(__dirname, '.seed-assets');
const MANIFEST = path.join(ASSETS_DIR, 'manifest.tsv');

function ensureAssets() {
  if (fs.existsSync(MANIFEST)) return;
  console.log('seed-dev: generating seed media (first run)...');
  execFileSync('sh', [path.join(__dirname, 'make-seed-assets.sh')], { stdio: 'inherit' });
}

function mimeOf(file) {
  if (file.endsWith('.jpg')) return 'image/jpeg';
  if (file.endsWith('.mov')) return 'video/quicktime';
  return 'application/octet-stream';
}

class Jar {
  cookie = '';
  capture(res) {
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
  }
  header() {
    return this.cookie ? { Cookie: this.cookie } : {};
  }
}

async function login(person) {
  const jar = new Jar();
  const r1 = await fetch(`${TARGET}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: PIN }),
  });
  if (!r1.ok) throw new Error(`login failed for ${person}: ${r1.status} ${await r1.text()}`);
  jar.capture(r1);
  const r2 = await fetch(`${TARGET}/api/session/person`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...jar.header() },
    body: JSON.stringify({ person }),
  });
  if (!r2.ok) throw new Error(`set person failed for ${person}: ${r2.status}`);
  jar.capture(r2);
  return jar;
}

async function tusUploadFile(jar, filePath, fileName, mime) {
  const buf = fs.readFileSync(filePath);
  const filenameB64 = Buffer.from(fileName).toString('base64');
  const filetypeB64 = Buffer.from(mime).toString('base64');
  const lastModified = String(fs.statSync(filePath).mtimeMs | 0);
  const lastModifiedB64 = Buffer.from(lastModified).toString('base64');

  const createRes = await fetch(`${TARGET}/api/uploads/`, {
    method: 'POST',
    headers: {
      ...jar.header(),
      'Tus-Resumable': '1.0.0',
      'Upload-Length': String(buf.length),
      'Upload-Metadata': `filename ${filenameB64},filetype ${filetypeB64},lastModified ${lastModifiedB64}`,
    },
  });
  if (createRes.status !== 201) {
    throw new Error(`create failed for ${fileName}: ${createRes.status} ${await createRes.text()}`);
  }
  const location = createRes.headers.get('location');
  const uploadUrl = new URL(location, `${TARGET}/api/uploads/`).toString();

  const patchRes = await fetch(uploadUrl, {
    method: 'PATCH',
    headers: {
      ...jar.header(),
      'Tus-Resumable': '1.0.0',
      'Upload-Offset': '0',
      'Content-Type': 'application/offset+octet-stream',
    },
    body: buf,
  });
  if (patchRes.status !== 204) {
    throw new Error(`patch failed for ${fileName}: ${patchRes.status} ${await patchRes.text()}`);
  }
  return {
    itemId: patchRes.headers.get('faelles-item-id'),
    duplicate: patchRes.headers.get('faelles-duplicate') === '1',
  };
}

async function main() {
  ensureAssets();
  const lines = fs
    .readFileSync(MANIFEST, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split('\t'));

  console.log(`seed-dev: target ${TARGET}, ${lines.length} assets`);

  const jars = new Map();
  for (const person of ['alex', 'sam', 'chris', 'edi']) {
    jars.set(person, await login(person));
  }

  const uploaded = [];
  for (const [file, kind, person] of lines) {
    const jar = jars.get(person);
    const filePath = path.join(ASSETS_DIR, file);
    try {
      const res = await tusUploadFile(jar, filePath, file, mimeOf(file));
      uploaded.push({ file, kind, person, ...res });
      process.stdout.write(res.duplicate ? 'd' : '.');
    } catch (err) {
      process.stdout.write('x');
      console.error(`\nseed-dev: ${file} failed: ${err.message}`);
    }
  }
  console.log(`\nseed-dev: uploaded ${uploaded.length}/${lines.length}`);

  // a handful of hearts / one highlight per day / a couple of captions, so
  // the library doesn't look untouched
  const ids = uploaded.map((u) => u.itemId).filter(Boolean);
  const heartedBy = ['alex', 'sam', 'chris', 'edi'];
  for (let i = 0; i < Math.min(6, ids.length); i++) {
    const id = ids[i * 3] ?? ids[i];
    const person = heartedBy[i % heartedBy.length];
    const jar = jars.get(person);
    await fetch(`${TARGET}/api/items/${id}/heart`, { method: 'PUT', headers: jar.header() }).catch(() => {});
  }
  for (let i = 0; i < Math.min(2, ids.length); i++) {
    const id = ids[i * 5 + 2] ?? ids[i];
    const jar = jars.get('alex');
    await fetch(`${TARGET}/api/items/${id}/highlight`, { method: 'PUT', headers: jar.header() }).catch(() => {});
  }

  const jar = jars.get('alex');
  const captionRes = await fetch(`${TARGET}/api/library`, { headers: jar.header() });
  if (captionRes.ok) {
    const lib = await captionRes.json();
    const days = [...new Set(lib.items.map((i) => i.day))].filter((d) => d !== 'before' && d !== 'after');
    const captionText = ['Off to a good start!', 'Best day yet.', 'Louisiana was worth it.'];
    for (let i = 0; i < days.length; i++) {
      await fetch(`${TARGET}/api/days/${days[i]}/caption`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...jar.header() },
        body: JSON.stringify({ text: captionText[i % captionText.length] }),
      }).catch(() => {});
    }
  }

  console.log('seed-dev: done. hearts/highlights/captions set.');
}

main().catch((err) => {
  console.error('seed-dev failed:', err);
  process.exit(1);
});
