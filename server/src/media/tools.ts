/**
 * Boot-time detection of the external media tools (PLAN.md §1.6). Missing
 * tools make items `failed` instead of crashing the server.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { HealthDTO } from '@shared/api';

const execFileAsync = promisify(execFile);

async function ok(cmd: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(cmd, args, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export interface ToolReport {
  vips: boolean;
  heif: boolean;
  ffmpeg: boolean;
  exiftool: boolean;
  /** ffmpeg's zscale filter, used for HDR tonemapping when present. */
  zscale: boolean;
}

export async function detectTools(): Promise<ToolReport> {
  const [vips, ffmpeg, exiftool] = await Promise.all([
    ok('vips', ['--version']),
    ok('ffmpeg', ['-version']),
    ok('exiftool', ['-ver']),
  ]);
  let heif = false;
  if (vips) {
    try {
      const { stdout } = await execFileAsync('vips', ['-l'], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
      heif = /heif/i.test(stdout);
    } catch {
      heif = false;
    }
  }
  let zscale = false;
  if (ffmpeg) {
    try {
      const { stdout } = await execFileAsync('ffmpeg', ['-filters'], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
      zscale = /\bzscale\b/.test(stdout);
    } catch {
      zscale = false;
    }
  }
  return { vips, heif, ffmpeg, exiftool, zscale };
}

export function toHealthTools(r: ToolReport): HealthDTO['tools'] {
  return { vips: r.vips, heif: r.heif, ffmpeg: r.ffmpeg, exiftool: r.exiftool };
}
