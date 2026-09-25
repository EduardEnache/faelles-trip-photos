import fsp from 'node:fs/promises';

/** rename, falling back to copy+unlink across devices (shouldn't happen inside one bind mount, but safe). */
export async function moveFile(src: string, dest: string): Promise<void> {
  try {
    await fsp.rename(src, dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      await fsp.copyFile(src, dest);
      await fsp.unlink(src);
    } else {
      throw err;
    }
  }
}

/** rename a directory, tolerating it not existing (nothing to move). */
export async function moveDirIfExists(src: string, dest: string): Promise<void> {
  try {
    await fsp.rename(src, dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      await fsp.cp(src, dest, { recursive: true });
      await fsp.rm(src, { recursive: true, force: true });
      return;
    }
    throw err;
  }
}
