import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Upload } from 'tus-js-client';
import { buildApp, type BuiltApp } from '../src/app';
import type { ItemDTO, LibraryDTO, SessionDTO, ServerEvent, UploadResultDTO, ZipTicketDTO } from '@shared/api';

function hasTool(cmd: string, args: string[]): boolean {
  try {
    execFileSync(cmd, args, { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
const HAS_EXIFTOOL = hasTool('exiftool', ['-ver']);
const HAS_VIPS = hasTool('vips', ['--version']);
const HAS_FFMPEG = hasTool('ffmpeg', ['-version']);

const FIXTURES = path.join(__dirname, 'fixtures');
function fixture(name: string): Buffer {
  return fs.readFileSync(path.join(FIXTURES, name));
}
function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Minimal cookie jar: only ever holds our one session cookie. */
class Jar {
  cookie = '';
  capture(res: Response) {
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0]!;
  }
  header(): Record<string, string> {
    return this.cookie ? { Cookie: this.cookie } : {};
  }
}

async function login(base: string, pin: string, person: string): Promise<Jar> {
  const jar = new Jar();
  const r1 = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
  expect(r1.status).toBe(200);
  jar.capture(r1);
  const r2 = await fetch(`${base}/api/session/person`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...jar.header() },
    body: JSON.stringify({ person }),
  });
  expect(r2.status).toBe(200);
  jar.capture(r2);
  return jar;
}

function tusUpload(
  base: string,
  jar: Jar,
  buf: Buffer,
  metadata: { filename: string; filetype: string; lastModified?: string },
): Promise<{ headers: Record<string, string>; uploadUrl: string }> {
  return new Promise((resolve, reject) => {
    const upload = new Upload(buf, {
      endpoint: `${base}/api/uploads/`,
      metadata,
      headers: jar.header(),
      chunkSize: 5 * 1024 * 1024,
      retryDelays: null,
      onError: reject,
      onAfterResponse: (_req, res) => {
        if (res.getStatus() >= 200 && res.getStatus() < 300 && res.getHeader('Faelles-Item-Id')) {
          const headers: Record<string, string> = {};
          for (const name of ['Faelles-Item-Id', 'Faelles-Duplicate']) {
            const v = res.getHeader(name);
            if (v) headers[name] = v;
          }
          (upload as unknown as { __finalHeaders?: Record<string, string> }).__finalHeaders = headers;
        }
        return undefined;
      },
      onSuccess: () => {
        const headers = (upload as unknown as { __finalHeaders?: Record<string, string> }).__finalHeaders ?? {};
        resolve({ headers, uploadUrl: upload.url ?? '' });
      },
    });
    upload.start();
  });
}

describe('fælles. server integration', () => {
  let built: BuiltApp;
  let base: string;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faelles-test-'));
    built = await buildApp({ storageDir: tmpDir, pin: '1234', port: 0, host: '127.0.0.1', isTest: true });
    await built.app.listen({ port: 0, host: '127.0.0.1' });
    const addr = built.app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await built.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('health reports tool detection', async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    const body = await json<{ ok: true; tools: Record<string, boolean> }>(res);
    expect(body.ok).toBe(true);
    expect(body.tools.vips).toBe(HAS_VIPS);
    expect(body.tools.exiftool).toBe(HAS_EXIFTOOL);
  });

  it('GET session without a cookie: authenticated false, not 401', async () => {
    const res = await fetch(`${base}/api/session`);
    expect(res.status).toBe(200);
    const body = await json<SessionDTO>(res);
    expect(body.authenticated).toBe(false);
  });

  it('protected routes 401 without a session', async () => {
    const res = await fetch(`${base}/api/library`);
    expect(res.status).toBe(401);
    const body = await json<{ error: string }>(res);
    expect(body.error).toBe('unauthenticated');
  });

  it('wrong PIN → 401 wrong_pin with attemptsLeft, right PIN → 200 and sets cookie', async () => {
    const wrong = await fetch(`${base}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '0000' }),
    });
    expect(wrong.status).toBe(401);
    const body = await json<{ error: string; attemptsLeft: number }>(wrong);
    expect(body.error).toBe('wrong_pin');
    expect(body.attemptsLeft).toBeLessThan(5);

    const right = await fetch(`${base}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '1234' }),
    });
    expect(right.status).toBe(200);
    expect(right.headers.get('set-cookie')).toMatch(/faelles_session=/);
  });

  it('no-person mutation → 409 no_person', async () => {
    const jar = new Jar();
    const r = await fetch(`${base}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '1234' }),
    });
    jar.capture(r);
    const capRes = await fetch(`${base}/api/days/2026-09-25/caption`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...jar.header() },
      body: JSON.stringify({ text: 'hi' }),
    });
    expect(capRes.status).toBe(409);
    const body = await json<{ error: string }>(capRes);
    expect(body.error).toBe('no_person');
  });

  it('rewriteUrl: the same handlers respond under the /photos prefix', async () => {
    const res = await fetch(`${base}/photos/api/health`);
    expect(res.status).toBe(200);
    const jar = await login(`${base}/photos`, '1234', 'sam');
    const lib = await fetch(`${base}/photos/api/library`, { headers: jar.header() });
    expect(lib.status).toBe(200);
  });

  it('SPA fallback serves something for unknown non-api paths, never a redirect loop', async () => {
    const res = await fetch(`${base}/photos/some/deep/route`, { redirect: 'manual' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  describe('real tus uploads (fixtures)', () => {
    let jar: Jar;
    beforeAll(async () => {
      jar = await login(base, '1234', 'alex');
    });

    it('iPhone JPEG: byte-identical, exact-zone EXIF date, GPS Nyhavn', async () => {
      const buf = fixture('jpeg-iphone-nyhavn.jpg');
      const { headers } = await tusUpload(base, jar, buf, {
        filename: 'jpeg-iphone-nyhavn.jpg',
        filetype: 'image/jpeg',
        lastModified: String(Date.now()),
      });
      expect(headers['Faelles-Duplicate']).toBe('0');
      const id = headers['Faelles-Item-Id'];
      expect(id).toBeTruthy();

      const itemRes = await fetch(`${base}/api/items/${id}`, { headers: jar.header() });
      const item = await json<ItemDTO>(itemRes);
      expect(item.uploader).toBe('alex');
      expect(item.bytes).toBe(buf.length);

      const orig = await fetch(`${base}/api/media/${id}/original`, { headers: jar.header() });
      const origBuf = Buffer.from(await orig.arrayBuffer());
      expect(sha256(origBuf)).toBe(sha256(buf));

      if (HAS_EXIFTOOL) {
        expect(item.dateSource).toBe('exif');
        expect(item.takenAt).toBe('2026-09-26T12:03:11.000Z');
        expect(item.day).toBe('2026-09-26');
        expect(item.lat).toBeCloseTo(55.6798, 3);
        expect(item.lon).toBeCloseTo(12.5911, 3);
        expect(item.camera).toBe('iPhone 16 Pro');
      }
    });

    it('Samsung JPEG (modern, offset present): exact date, portrait dims from Orientation 6', async () => {
      const buf = fixture('jpeg-samsung-modern-portrait.jpg');
      const { headers } = await tusUpload(base, jar, buf, {
        filename: 'jpeg-samsung-modern-portrait.jpg',
        filetype: 'image/jpeg',
      });
      const id = headers['Faelles-Item-Id'];
      const item = await json<ItemDTO>(await fetch(`${base}/api/items/${id}`, { headers: jar.header() }));
      if (HAS_EXIFTOOL) {
        expect(item.dateSource).toBe('exif');
        expect(item.takenAt).toBe('2026-09-27T08:15:00.000Z');
        expect(item.camera).toBe('SM-S928B');
        expect(item.width).toBe(480);
        expect(item.height).toBe(640);
      }
    });

    it('Samsung JPEG (older, no offset): falls back to Copenhagen wall time', async () => {
      const buf = fixture('jpeg-samsung-older-nooffset.jpg');
      const { headers } = await tusUpload(base, jar, buf, {
        filename: 'jpeg-samsung-older-nooffset.jpg',
        filetype: 'image/jpeg',
      });
      const id = headers['Faelles-Item-Id'];
      const item = await json<ItemDTO>(await fetch(`${base}/api/items/${id}`, { headers: jar.header() }));
      if (HAS_EXIFTOOL) {
        expect(item.dateSource).toBe('exif-local');
        expect(item.takenAt).toBe('2026-09-25T07:30:00.000Z');
      }
    });

    it('PNG with no EXIF: dateSource file (from lastModified)', async () => {
      const buf = fixture('png-no-exif.png');
      const lm = Date.parse('2026-09-25T06:00:00Z');
      const { headers } = await tusUpload(base, jar, buf, {
        filename: 'png-no-exif.png',
        filetype: 'image/png',
        lastModified: String(lm),
      });
      const id = headers['Faelles-Item-Id'];
      const item = await json<ItemDTO>(await fetch(`${base}/api/items/${id}`, { headers: jar.header() }));
      expect(item.dateSource).toBe('file');
      expect(item.takenAt).toBe(new Date(lm).toISOString());
    });

    it('iPhone HEVC .mov: Keys:CreationDate (zoned) wins over QuickTime:CreateDate (UTC); GPS Kronborg', async () => {
      const buf = fixture('mov-iphone-hevc-kronborg.mov');
      const { headers } = await tusUpload(base, jar, buf, {
        filename: 'mov-iphone-hevc-kronborg.mov',
        filetype: 'video/quicktime',
      });
      const id = headers['Faelles-Item-Id'];
      const item = await json<ItemDTO>(await fetch(`${base}/api/items/${id}`, { headers: jar.header() }));
      expect(item.kind).toBe('video');
      if (HAS_EXIFTOOL) {
        expect(item.dateSource).toBe('exif');
        // Keys:CreationDate is baked in relative to "now" at fixture-generation
        // time (see make-fixtures.sh), so plausibility (§1.5: not >2 days in
        // the future) holds whenever this suite runs. The sidecar records the
        // expected UTC instant; if it's missing (stale fixtures), just skip
        // the exact-time assertion rather than fail on a moving target.
        const sidecar = path.join(FIXTURES, '.kronborg-expected-utc-date');
        if (fs.existsSync(sidecar)) {
          // sidecar is "YYYY:MM:DD HH:MM:SS" (exiftool-style) → ISO
          const iso = fs
            .readFileSync(sidecar, 'utf8')
            .trim()
            .replace(/^(\d{4}):(\d{2}):(\d{2}) (.*)$/, '$1-$2-$3T$4Z');
          expect(item.takenAt).toBe(new Date(iso).toISOString());
        }
        expect(item.lat).toBeCloseTo(56.039, 2);
        expect(item.lon).toBeCloseTo(12.6212, 2);
      }
    });

    it('Samsung H.264 .mp4: only QuickTime:CreateDate (UTC) → video-utc', async () => {
      const buf = fixture('mp4-samsung-h264.mp4');
      const { headers } = await tusUpload(base, jar, buf, {
        filename: 'mp4-samsung-h264.mp4',
        filetype: 'video/mp4',
      });
      const id = headers['Faelles-Item-Id'];
      const item = await json<ItemDTO>(await fetch(`${base}/api/items/${id}`, { headers: jar.header() }));
      if (HAS_EXIFTOOL) {
        expect(item.dateSource).toBe('video-utc');
        expect(item.takenAt).toBe('2026-09-26T08:00:00.000Z');
      }
    });

    it("Samsung Motion Photo shape (JPEG + MP4 trailer) doesn't break processing", async () => {
      const buf = fixture('jpeg-samsung-motionphoto.jpg');
      const { headers } = await tusUpload(base, jar, buf, {
        filename: 'jpeg-samsung-motionphoto.jpg',
        filetype: 'image/jpeg',
      });
      expect(headers['Faelles-Item-Id']).toBeTruthy();
      const id = headers['Faelles-Item-Id'];
      const item = await json<ItemDTO>(await fetch(`${base}/api/items/${id}`, { headers: jar.header() }));
      expect(item.kind).toBe('photo');
      expect(item.status).not.toBe('failed on unexpected error'); // i.e. it resolved to a real status either way
    });

    it.skipIf(!fs.existsSync(path.join(FIXTURES, 'heic-iphone-louisiana.heic')))(
      'iPhone HEIC: decodes and gets a GPS-tagged capture date',
      async () => {
        const buf = fixture('heic-iphone-louisiana.heic');
        const { headers } = await tusUpload(base, jar, buf, {
          filename: 'heic-iphone-louisiana.heic',
          filetype: 'image/heic',
        });
        const id = headers['Faelles-Item-Id'];
        const item = await json<ItemDTO>(await fetch(`${base}/api/items/${id}`, { headers: jar.header() }));
        if (HAS_EXIFTOOL) {
          expect(item.dateSource).toBe('exif');
          expect(item.lat).toBeCloseTo(55.969, 2);
        }
      },
    );

    it.skipIf(!HAS_VIPS)('photo derivatives (thumb/display + tone) eventually exist', async () => {
      const buf = fixture('jpeg-iphone-nyhavn.jpg');
      const { headers } = await tusUpload(base, jar, buf, {
        filename: 'derivs.jpg',
        filetype: 'image/jpeg',
      });
      const id = headers['Faelles-Item-Id'];
      let item: ItemDTO | null = null;
      for (let i = 0; i < 50; i++) {
        item = await json<ItemDTO>(await fetch(`${base}/api/items/${id}`, { headers: jar.header() }));
        if (item.status !== 'processing') break;
        await new Promise((r) => setTimeout(r, 200));
      }
      expect(item!.status).toBe('ready');
      expect(item!.media.thumb).toBe(true);
      expect(item!.media.display).toBe(true);
      expect(item!.tone).toMatch(/^#[0-9a-f]{6}$/);

      const thumb = await fetch(`${base}/api/media/${id}/thumb`, { headers: jar.header() });
      expect(thumb.status).toBe(200);
      expect(thumb.headers.get('content-type')).toBe('image/webp');
    });

    it.skipIf(!HAS_FFMPEG || !HAS_VIPS)('video derivatives (poster + preview) eventually exist', async () => {
      const buf = fixture('mov-iphone-hevc-kronborg.mov');
      const { headers } = await tusUpload(base, jar, buf, {
        filename: 'video-derivs.mov',
        filetype: 'video/quicktime',
      });
      const id = headers['Faelles-Item-Id'];
      let item: ItemDTO | null = null;
      for (let i = 0; i < 150; i++) {
        item = await json<ItemDTO>(await fetch(`${base}/api/items/${id}`, { headers: jar.header() }));
        if (item.status !== 'processing') break;
        await new Promise((r) => setTimeout(r, 400));
      }
      expect(item!.status).toBe('ready');
      expect(item!.media.thumb).toBe(true);
      expect(item!.media.preview).toBe(true);
      const preview = await fetch(`${base}/api/media/${id}/preview`, { headers: jar.header() });
      expect(preview.status).toBe(200);
      expect(preview.headers.get('content-type')).toBe('video/mp4');
    }, 60_000);

    it.skipIf(!HAS_FFMPEG || !HAS_VIPS)('HLG HDR clip tonemaps to a playable SDR preview without erroring', async () => {
      const buf = fixture('mov-hlg-hevc.mov');
      const { headers } = await tusUpload(base, jar, buf, {
        filename: 'hlg.mov',
        filetype: 'video/quicktime',
      });
      const id = headers['Faelles-Item-Id'];
      let item: ItemDTO | null = null;
      for (let i = 0; i < 150; i++) {
        item = await json<ItemDTO>(await fetch(`${base}/api/items/${id}`, { headers: jar.header() }));
        if (item.status !== 'processing') break;
        await new Promise((r) => setTimeout(r, 400));
      }
      expect(item!.status).toBe('ready');
      expect(item!.media.preview).toBe(true);
    }, 60_000);

    it('duplicate upload (same bytes) returns the existing item with duplicate:1, no new item', async () => {
      const buf = fixture('png-no-exif.png');
      const first = await tusUpload(base, jar, buf, { filename: 'dup1.png', filetype: 'image/png' });
      const libBefore = await json<LibraryDTO>(await fetch(`${base}/api/library`, { headers: jar.header() }));
      const countBefore = libBefore.items.length;

      const second = await tusUpload(base, jar, buf, { filename: 'dup2.png', filetype: 'image/png' });
      expect(second.headers['Faelles-Duplicate']).toBe('1');
      expect(second.headers['Faelles-Item-Id']).toBe(first.headers['Faelles-Item-Id']);

      const libAfter = await json<LibraryDTO>(await fetch(`${base}/api/library`, { headers: jar.header() }));
      expect(libAfter.items.length).toBe(countBefore);
    });

    it('GET upload-results/:uploadId reflects the finished upload (fallback path)', async () => {
      const buf = fixture('png-no-exif.png');
      const { uploadUrl, headers } = await tusUpload(base, jar, buf, {
        filename: 'results.png',
        filetype: 'image/png',
      });
      const uploadId = uploadUrl.split('/').filter(Boolean).pop()!;
      const res = await fetch(`${base}/api/upload-results/${uploadId}`, { headers: jar.header() });
      expect(res.status).toBe(200);
      const body = await json<UploadResultDTO>(res);
      expect(body.item.id).toBe(headers['Faelles-Item-Id']);
    });
  });

  describe('resumable upload (raw tus protocol): interruption then resume', () => {
    it('a partial PATCH followed by a later PATCH from the reported offset finishes the upload byte-identical', async () => {
      const jar = await login(base, '1234', 'chris');
      const buf = fixture('jpeg-samsung-older-nooffset.jpg');
      const filenameB64 = Buffer.from('resume-test.jpg').toString('base64');
      const filetypeB64 = Buffer.from('image/jpeg').toString('base64');

      const createRes = await fetch(`${base}/api/uploads/`, {
        method: 'POST',
        headers: {
          ...jar.header(),
          'Tus-Resumable': '1.0.0',
          'Upload-Length': String(buf.length),
          'Upload-Metadata': `filename ${filenameB64},filetype ${filetypeB64}`,
        },
      });
      expect(createRes.status).toBe(201);
      const location = createRes.headers.get('location')!;
      const uploadUrl = new URL(location, `${base}/api/uploads/`).toString();

      // simulate a dropped connection: PATCH only the first half
      const half = Math.floor(buf.length / 2);
      const patch1 = await fetch(uploadUrl, {
        method: 'PATCH',
        headers: {
          ...jar.header(),
          'Tus-Resumable': '1.0.0',
          'Upload-Offset': '0',
          'Content-Type': 'application/offset+octet-stream',
        },
        body: buf.subarray(0, half),
      });
      expect(patch1.status).toBe(204);
      expect(patch1.headers.get('upload-offset')).toBe(String(half));
      // finalize headers must NOT be present yet (upload isn't complete)
      expect(patch1.headers.get('faelles-item-id')).toBeNull();

      // "reconnect": HEAD to discover the offset, exactly like tus-js-client does on resume
      const head = await fetch(uploadUrl, { method: 'HEAD', headers: { ...jar.header(), 'Tus-Resumable': '1.0.0' } });
      expect(head.status).toBe(200);
      expect(head.headers.get('upload-offset')).toBe(String(half));

      // finish the upload from the reported offset
      const patch2 = await fetch(uploadUrl, {
        method: 'PATCH',
        headers: {
          ...jar.header(),
          'Tus-Resumable': '1.0.0',
          'Upload-Offset': String(half),
          'Content-Type': 'application/offset+octet-stream',
        },
        body: buf.subarray(half),
      });
      expect(patch2.status).toBe(204);
      const itemId = patch2.headers.get('faelles-item-id');
      expect(itemId).toBeTruthy();

      const orig = await fetch(`${base}/api/media/${itemId}/original`, { headers: jar.header() });
      const origBuf = Buffer.from(await orig.arrayBuffer());
      expect(sha256(origBuf)).toBe(sha256(buf));
    });
  });

  describe('mutations, SSE, and zip', () => {
    let jar: Jar;
    let itemId: string;

    beforeAll(async () => {
      jar = await login(base, '1234', 'edi');
      // Unique bytes (not reused from the "real tus uploads" describe above):
      // dedupe is by sha256 of content, so re-uploading a fixture verbatim
      // here would silently return THAT describe's item (owned by alex)
      // instead of creating a fresh one owned by edi.
      const buf = Buffer.concat([fixture('jpeg-iphone-nyhavn.jpg'), Buffer.from('mutations-describe-unique-marker')]);
      const { headers } = await tusUpload(base, jar, buf, { filename: 'mutations.jpg', filetype: 'image/jpeg' });
      itemId = headers['Faelles-Item-Id']!;
    });

    it('SSE stream sends hello then item.added/item.updated for live actions', async () => {
      const controller = new AbortController();
      const res = await fetch(`${base}/api/events`, { headers: jar.header(), signal: controller.signal });
      expect(res.status).toBe(200);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const events: ServerEvent[] = [];

      const readLoop = (async () => {
        while (events.length < 2) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) >= 0) {
            const chunk = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const line = chunk.split('\n').find((l) => l.startsWith('data: '));
            if (line) events.push(JSON.parse(line.slice(6)));
          }
        }
      })();

      // trigger an item.updated while we're listening
      await fetch(`${base}/api/items/${itemId}/heart`, { method: 'PUT', headers: jar.header() });

      await Promise.race([readLoop, new Promise((_, rej) => setTimeout(() => rej(new Error('SSE timeout')), 5000))]);
      controller.abort();

      expect(events[0]!.type).toBe('hello');
      expect(events.some((e) => e.type === 'item.updated')).toBe(true);
    });

    it('hearts and highlight are idempotent and broadcast the updated item', async () => {
      const on = await json<ItemDTO>(
        await fetch(`${base}/api/items/${itemId}/heart`, { method: 'PUT', headers: jar.header() }),
      );
      expect(on.hearts).toContain('edi');
      const onAgain = await json<ItemDTO>(
        await fetch(`${base}/api/items/${itemId}/heart`, { method: 'PUT', headers: jar.header() }),
      );
      expect(onAgain.hearts.filter((p) => p === 'edi').length).toBe(1);
      const off = await json<ItemDTO>(
        await fetch(`${base}/api/items/${itemId}/heart`, { method: 'DELETE', headers: jar.header() }),
      );
      expect(off.hearts).not.toContain('edi');

      const hi = await json<ItemDTO>(
        await fetch(`${base}/api/items/${itemId}/highlight`, { method: 'PUT', headers: jar.header() }),
      );
      expect(hi.highlighted).toBe(true);
      expect(hi.highlightedBy).toBe('edi');
    });

    it('captions: set, empty text deletes', async () => {
      const set = await fetch(`${base}/api/days/2026-09-26/caption`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...jar.header() },
        body: JSON.stringify({ text: '  Great day!  ' }),
      });
      expect(set.status).toBe(200);
      const caption = await json<{ text: string }>(set);
      expect(caption.text).toBe('Great day!');

      const del = await fetch(`${base}/api/days/2026-09-26/caption`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...jar.header() },
        body: JSON.stringify({ text: '' }),
      });
      const body = await json<{ text: string | null }>(del);
      expect(body.text).toBeNull();
    });

    it('delete moves to trash (own item), restore brings it back', async () => {
      const del = await fetch(`${base}/api/items/${itemId}`, { method: 'DELETE', headers: jar.header() });
      expect(del.status).toBe(204);

      const gone = await fetch(`${base}/api/items/${itemId}`, { headers: jar.header() });
      // other people can't see it; the owner still can (undo)
      const asOwner = await json<ItemDTO>(gone);
      expect(asOwner.id).toBe(itemId);

      const libAfterDelete = await json<LibraryDTO>(await fetch(`${base}/api/library`, { headers: jar.header() }));
      expect(libAfterDelete.items.find((i) => i.id === itemId)).toBeUndefined();

      const restore = await fetch(`${base}/api/items/${itemId}/restore`, { method: 'POST', headers: jar.header() });
      expect(restore.status).toBe(200);
      const libAfterRestore = await json<LibraryDTO>(await fetch(`${base}/api/library`, { headers: jar.header() }));
      expect(libAfterRestore.items.find((i) => i.id === itemId)).toBeTruthy();
    });

    it("deleting someone else's upload is 403 not_owner", async () => {
      const otherJar = await login(base, '1234', 'sam');
      const res = await fetch(`${base}/api/items/${itemId}`, { method: 'DELETE', headers: otherJar.header() });
      expect(res.status).toBe(403);
    });

    it('zip: Content-Length equals the streamed bytes and unzips to identical original bytes', async () => {
      const orig = fixture('jpeg-iphone-nyhavn.jpg');
      const ticketRes = await fetch(`${base}/api/zip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...jar.header() },
        body: JSON.stringify({ ids: [itemId] }),
      });
      expect(ticketRes.status).toBe(200);
      const ticket = await json<ZipTicketDTO>(ticketRes);
      expect(ticket.count).toBe(1);

      const dl = await fetch(`${base}/api/zip/${ticket.token}`, { headers: jar.header() });
      expect(dl.status).toBe(200);
      const declaredLength = Number(dl.headers.get('content-length'));
      expect(declaredLength).toBe(ticket.bytes);
      const zipBuf = Buffer.from(await dl.arrayBuffer());
      expect(zipBuf.length).toBe(declaredLength);

      // STORE-mode zip: the original bytes appear verbatim inside (cheap way
      // to assert "unzips to identical bytes" without a zip-reading dep).
      expect(zipBuf.includes(orig.subarray(0, 256))).toBe(true);
    });

    it('an expired/unknown zip token is 410 gone', async () => {
      const res = await fetch(`${base}/api/zip/not-a-real-token`, { headers: jar.header() });
      expect(res.status).toBe(410);
    });
  });

  // Deliberately LAST: this locks out 127.0.0.1 (the IP every other test in
  // this file also logs in from), so nothing after it can call login().
  it('5 wrong PINs from one IP → 429 locked with Retry-After', async () => {
    let last: Response | null = null;
    for (let i = 0; i < 6; i++) {
      last = await fetch(`${base}/api/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: '9999' }),
      });
    }
    expect(last!.status).toBe(429);
    expect(last!.headers.get('retry-after')).toBeTruthy();
    const body = await json<{ error: string; retryAfterSec: number }>(last!);
    expect(body.error).toBe('locked');
    expect(body.retryAfterSec).toBeGreaterThan(0);
  });
});
