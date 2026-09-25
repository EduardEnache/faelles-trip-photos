/**
 * vips-based photo derivatives (PLAN.md §1.6): thumb.webp, display.webp,
 * dominant `tone` colour. DNG/RAW fallback to an embedded preview via
 * exiftool when vips itself can't decode the file.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Semaphore } from '../util/semaphore';

const execFileAsync = promisify(execFile);
const execFileBuf = (cmd: string, args: string[], maxBuffer = 64 * 1024 * 1024) =>
  new Promise<Buffer>((resolve, reject) => {
    execFile(cmd, args, { encoding: 'buffer', maxBuffer, timeout: 120_000 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout as unknown as Buffer);
    });
  });

/** Bounds concurrent vips invocations independently of the derivation queue's own lane concurrency. */
export const vipsSemaphore = new Semaphore(4);

async function vips(args: string[]): Promise<void> {
  await vipsSemaphore.run(() => execFileAsync('vips', args, { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 }));
}

async function thumbnail(input: string, outSpec: string, width: number): Promise<void> {
  await vips(['thumbnail', input, outSpec, String(width), '--size', 'down', '--export-profile', 'srgb']);
}

function toHex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

async function computeTone(thumbPath: string, workDir: string): Promise<string | null> {
  const tonePath = path.join(workDir, `tone-${Date.now()}-${Math.random().toString(36).slice(2)}.v`);
  try {
    await vips(['thumbnail', thumbPath, tonePath, '1', '--height', '1', '--size', 'force']);
    const { stdout } = await execFileAsync('vips', ['getpoint', tonePath, '0', '0'], { timeout: 30_000 });
    const nums = stdout
      .trim()
      .split(/\s+/)
      .map(Number)
      .filter((n) => Number.isFinite(n));
    if (nums.length < 3) return null;
    const [r, g, b] = nums;
    return `#${toHex(r!)}${toHex(g!)}${toHex(b!)}`;
  } catch {
    return null;
  } finally {
    await fs.rm(tonePath, { force: true }).catch(() => {});
  }
}

async function extractEmbeddedPreview(originalPath: string): Promise<Buffer | null> {
  for (const tag of ['-JpgFromRaw', '-PreviewImage']) {
    try {
      const buf = await execFileBuf('exiftool', ['-b', tag, originalPath]);
      if (buf && buf.length > 100) return buf;
    } catch {
      // try next tag
    }
  }
  return null;
}

export interface PhotoDerivResult {
  ok: boolean;
  tone: string | null;
  error: string | null;
}

/**
 * Generates thumb.webp / display.webp / tone into `derivedDir` (already
 * created by the caller). Tries vips directly; for RAW/DNG that vips can't
 * decode, falls back to the embedded JPEG preview.
 */
export async function generatePhotoDerivatives(originalPath: string, derivedDir: string): Promise<PhotoDerivResult> {
  const thumbPath = path.join(derivedDir, 'thumb.webp');
  const displayPath = path.join(derivedDir, 'display.webp');

  const tryFrom = async (src: string): Promise<boolean> => {
    try {
      await thumbnail(src, `${thumbPath}[Q=76,strip]`, 640);
      await thumbnail(src, `${displayPath}[Q=82,strip]`, 2048);
      return true;
    } catch {
      return false;
    }
  };

  let success = await tryFrom(originalPath);
  if (!success) {
    const preview = await extractEmbeddedPreview(originalPath);
    if (preview) {
      const tmp = path.join(os.tmpdir(), `faelles-raw-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
      try {
        await fs.writeFile(tmp, preview);
        success = await tryFrom(tmp);
      } finally {
        await fs.rm(tmp, { force: true }).catch(() => {});
      }
    }
  }

  if (!success) {
    return { ok: false, tone: null, error: 'No preview for this RAW file. The original is safe.' };
  }

  const tone = await computeTone(thumbPath, derivedDir);
  return { ok: true, tone, error: null };
}

/** Generates thumb.webp / display.webp from an already-extracted poster JPEG (videos). */
export async function generatePosterDerivatives(posterJpegPath: string, derivedDir: string): Promise<PhotoDerivResult> {
  return generatePhotoDerivatives(posterJpegPath, derivedDir);
}
