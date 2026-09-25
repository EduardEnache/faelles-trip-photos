/**
 * ffprobe/ffmpeg video handling (PLAN.md §1.6): probing, poster frame,
 * H.264/AAC preview with HDR→SDR tonemapping when available.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Semaphore } from '../util/semaphore';

const execFileAsync = promisify(execFile);
export const ffmpegSemaphore = new Semaphore(2);

const HDR_TRANSFERS = new Set(['arib-std-b67', 'smpte2084']);

interface FfprobeStream {
  codec_type?: string;
  width?: number;
  height?: number;
  color_transfer?: string;
  duration?: string;
  tags?: Record<string, string>;
  side_data_list?: { rotation?: number; side_data_type?: string }[];
}
interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: { duration?: string };
}

export interface ProbeResult {
  durationMs: number | null;
  width: number | null;
  height: number | null;
  isHdr: boolean;
}

export async function probeVideo(filePath: string): Promise<ProbeResult> {
  const { stdout } = await execFileAsync(
    'ffprobe',
    ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', filePath],
    { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 },
  );
  const data = JSON.parse(stdout) as FfprobeOutput;
  const stream = (data.streams ?? []).find((s) => s.codec_type === 'video');
  if (!stream) return { durationMs: null, width: null, height: null, isHdr: false };

  let rotation = 0;
  for (const sd of stream.side_data_list ?? []) {
    if (typeof sd.rotation === 'number') rotation = sd.rotation;
  }
  const tagRotate = stream.tags?.rotate ? Number(stream.tags.rotate) : 0;
  if (!rotation && tagRotate) rotation = tagRotate;
  const swapped = Math.abs(rotation) % 180 === 90;

  let width = stream.width ?? null;
  let height = stream.height ?? null;
  if (swapped && width != null && height != null) [width, height] = [height, width];

  const durationSec = Number(stream.duration ?? data.format?.duration ?? NaN);
  const durationMs = Number.isFinite(durationSec) ? Math.round(durationSec * 1000) : null;

  const isHdr = !!stream.color_transfer && HDR_TRANSFERS.has(stream.color_transfer);

  return { durationMs, width, height, isHdr };
}

export async function extractPosterFrame(filePath: string, outJpegPath: string, atMs: number): Promise<void> {
  const atSec = Math.max(0, atMs / 1000);
  await ffmpegSemaphore.run(() =>
    execFileAsync(
      'ffmpeg',
      ['-y', '-ss', atSec.toFixed(3), '-i', filePath, '-frames:v', '1', '-q:v', '2', outJpegPath],
      { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
    ),
  );
}

function buildVideoFilter(isHdr: boolean, zscaleAvailable: boolean): string {
  const scale = "scale='min(1280,iw)':'min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2";
  if (isHdr && zscaleAvailable) {
    return `zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,${scale}`;
  }
  if (isHdr) {
    return `format=yuv420p,${scale}`;
  }
  return `${scale},format=yuv420p`;
}

export interface TranscodeOptions {
  isHdr: boolean;
  zscaleAvailable: boolean;
  /** Overridable for tests to keep them fast. */
  timeoutMs?: number;
}

export async function transcodePreview(filePath: string, outTmpMp4Path: string, opts: TranscodeOptions): Promise<void> {
  const vf = buildVideoFilter(opts.isHdr, opts.zscaleAvailable);
  const args = [
    '-y',
    '-i',
    filePath,
    '-vf',
    vf,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-profile:v',
    'high',
    '-pix_fmt',
    'yuv420p',
    '-fpsmax',
    '30',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-ac',
    '2',
    '-movflags',
    '+faststart',
    '-threads',
    '4',
    outTmpMp4Path,
  ];
  await ffmpegSemaphore.run(() =>
    execFileAsync('ffmpeg', args, { timeout: opts.timeoutMs ?? 30 * 60_000, maxBuffer: 8 * 1024 * 1024 }),
  );
}
