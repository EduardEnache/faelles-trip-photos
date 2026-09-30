/**
 * file picking that survives iOS Safari.
 *
 * Every pick gets its own <input type=file>, attached to <body> (not to the
 * upload sheet) and kept until the queue has finished with its files:
 *  - iOS copies the chosen photos out of the library AFTER "Add" is tapped and
 *    only then fires `change` — for big originals (48 MP HEIC, ProRAW, video)
 *    that takes seconds to minutes. An input that re-rendered or was
 *    unmounted in the meantime never receives the event, so nothing happens.
 *  - Resetting `input.value` (the old way to allow re-picking the same file)
 *    lets WebKit drop the files behind a FileList that's still uploading.
 *    A fresh input per pick never needs a reset.
 */

interface PickSession {
  input: HTMLInputElement;
  files: File[];
}

const sessions: PickSession[] = [];

function removeInput(input: HTMLInputElement) {
  input.remove();
  const i = sessions.findIndex((s) => s.input === input);
  if (i >= 0) sessions.splice(i, 1);
}

export interface PickHandlers {
  onFiles(files: File[]): void;
  /** Picker dismissed without files (only where the browser fires `cancel`). */
  onCancel?(): void;
}

/** Opens the system picker. Must be called from a user gesture (a click). */
export function pickFiles(accept: string, handlers: PickHandlers): void {
  // Inputs from earlier picks that never got files (cancelled on a browser
  // without a `cancel` event) are dead weight now.
  for (const s of [...sessions]) if (!s.files.length) removeInput(s.input);

  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = accept;
  input.className = 'visually-hidden';
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  const session: PickSession = { input, files: [] };
  sessions.push(session);

  input.addEventListener('change', () => {
    const files = Array.from(input.files ?? []);
    if (!files.length) {
      removeInput(input);
      handlers.onCancel?.();
      return;
    }
    session.files = files;
    handlers.onFiles(files);
  });
  input.addEventListener('cancel', () => {
    removeInput(input);
    handlers.onCancel?.();
  });

  document.body.appendChild(input);
  input.click();
}

/** Drops inputs whose files the upload queue no longer holds. */
export function releasePickedFiles(isLive: (file: File) => boolean): void {
  for (const s of [...sessions]) {
    if (s.files.length && !s.files.some(isLive)) removeInput(s.input);
  }
}
