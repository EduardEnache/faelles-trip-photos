/**
 * exiftool wrapper. One call per file, bounded by a semaphore (default 4).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Semaphore } from '../util/semaphore';
import type { ExifTags } from './capture';

const execFileAsync = promisify(execFile);
const semaphore = new Semaphore(4);

export async function readExifTags(filePath: string): Promise<ExifTags> {
  return semaphore.run(async () => {
    try {
      const { stdout } = await execFileAsync(
        'exiftool',
        ['-json', '-n', '-G1', '-a', '-api', 'largefilesupport=1', filePath],
        { maxBuffer: 16 * 1024 * 1024 },
      );
      const parsed = JSON.parse(stdout) as ExifTags[];
      return parsed[0] ?? {};
    } catch {
      return {};
    }
  });
}
