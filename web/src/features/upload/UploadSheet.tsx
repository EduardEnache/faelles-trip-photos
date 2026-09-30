/**
 * screens 06/07: upload sheet (mobile bottom sheet / desktop
 * centred modal), progress and done states. The queue itself lives in
 * uploadQueue.ts and keeps running when this sheet is closed.
 */
import { useEffect, useMemo, useState } from 'react';
import { ACCEPT_ATTR } from '@shared/api';

/**
 * Phones get the bare MIME wildcards: any extra extension in `accept` makes
 * Android Chrome skip its Photo Picker (gallery) and show a Camera/Files chooser
 * instead; iOS shows the Photos library either way. Desktop keeps the extensions
 * so OS file dialogs don't hide HEIC/RAW files they have no MIME mapping for.
 */
const IS_TOUCH = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
const PICKER_ACCEPT = IS_TOUCH ? 'image/*,video/*' : ACCEPT_ATTR;
/**
 * The Android gallery picker blanks GPS for privacy, so phones also get a
 * "pick from Files" input: the extensions make Android show its chooser
 * (Files / My Files), whose files keep their location.
 */
const FILES_ACCEPT = ACCEPT_ATTR;
/** iPhone/iPad (iPadOS reports as a Mac with touch). Its picker keeps locations, so no Files option. */
const IS_IOS =
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
import { personOf, sectionTitle, SECTION_ORDER, type DayKey } from '@shared/trip';
import { formatBytes, plural } from '@shared/format';
import { CheckIcon, CloseIcon, UploadIcon, WarningIcon } from '@/lib/icons';
import { IconButton } from '@/ui';
import { closeOverlay, goToDay, navigateTab } from '@/lib/router';
import { useSession } from '@/state/session';
import { useLibrary } from '@/state/library';
import { acknowledgeFinished, enqueueFiles, retryWithFile, stageOf, useUploadEntries } from './uploadQueue';
import { pickFiles } from './picker';
import { UploadRow } from './UploadRow';
import s from './UploadSheet.module.css';

export function UploadSheet({ wide }: { wide: boolean }) {
  const entries = useUploadEntries();
  const stage = stageOf(entries);
  const me = useSession((st) => st.session?.person ?? null);
  const startChoosing = useSession((st) => st.startChoosingPerson);
  const disk = useLibrary((st) => st.disk);
  const [drag, setDrag] = useState(false);
  /** Picker open, or iOS still copying the chosen photos out of the library. */
  const [awaiting, setAwaiting] = useState(false);

  const person = me ? personOf(me) : null;

  function openPicker(accept: string, retryFor: string | null = null) {
    setAwaiting(retryFor == null);
    pickFiles(accept, {
      onFiles(files) {
        setAwaiting(false);
        if (retryFor) retryWithFile(retryFor, files[0]!);
        else enqueueFiles(files);
      },
      onCancel: () => setAwaiting(false),
    });
  }

  const active = entries.filter(
    (e) => e.status === 'queued' || e.status === 'uploading' || e.status === 'waiting' || e.status === 'background',
  );
  const inBackground = entries.some((e) => e.status === 'background');
  const activeSent = active.reduce((a, e) => a + e.bytesSent, 0);
  const activeTotal = active.reduce((a, e) => a + e.size, 0);
  const activeDone = entries.filter((e) => e.status === 'done' || e.status === 'duplicate').length;
  const pct = activeTotal ? Math.round((activeSent / activeTotal) * 100) : 0;

  const finished = useMemo(() => entries.filter((e) => e.status === 'done' || e.status === 'duplicate'), [entries]);
  const doneDays = useMemo(() => {
    const keys = new Set<DayKey>();
    finished.forEach((e) => {
      if (e.day) keys.add(e.day);
    });
    return SECTION_ORDER.filter((k) => keys.has(k));
  }, [finished]);

  const sortedLine =
    finished.length > 0 && doneDays.length > 0
      ? `Sorted into ${doneDays.map((d) => sectionTitle(d)).join(' & ')} by capture date, with camera and location read from each file.`
      : 'Reading dates and locations from each file…';

  const newCount = finished.filter((e) => e.status === 'done').length;
  const duplicateCount = finished.length - newCount;
  const doneTitle =
    newCount === 0 && duplicateCount > 0
      ? `Already in the album`
      : duplicateCount > 0
        ? `${plural(newCount, 'original')} added · ${duplicateCount} already in the album`
        : `${plural(newCount, 'original')} added`;

  function viewInLibrary() {
    const lastDay = doneDays[doneDays.length - 1];
    acknowledgeFinished();
    closeOverlay();
    if (lastDay) goToDay(lastDay);
    else navigateTab('library');
  }

  function addMore() {
    acknowledgeFinished();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeOverlay();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={[s.backdrop, wide && s.wide].filter(Boolean).join(' ')} onClick={closeOverlay}>
      <div className={s.sheet} role="dialog" aria-modal="true" aria-label="Upload" onClick={(e) => e.stopPropagation()}>
        <div className={s.head}>
          <div className={s.title}>
            {stage === 'pick' ? 'Add to the album' : stage === 'progress' ? 'Uploading originals' : 'All done'}
          </div>
          <IconButton label="Close" onClick={closeOverlay}>
            <CloseIcon />
          </IconButton>
        </div>

        {stage === 'pick' && (
          <>
            <div className={s.asRow}>
              <span className={s.asAvatar} style={{ background: person?.color ?? 'var(--sten)' }} aria-hidden="true">
                {person?.name[0] ?? '?'}
              </span>
              <span>
                Uploading as <span className={s.asName}>{person?.name ?? 'unknown'}</span>
              </span>
              <button type="button" className={s.change} onClick={startChoosing}>
                Change
              </button>
            </div>

            {disk?.uploadsBlocked ? (
              <div className={s.lowSpace} role="alert">
                <WarningIcon aria-hidden />
                Not enough storage on the server right now. Try again later.
              </div>
            ) : (
              <button
                type="button"
                className={[s.drop, (drag || awaiting) && s.active].filter(Boolean).join(' ')}
                onClick={() => openPicker(PICKER_ACCEPT)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDrag(true);
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDrag(false);
                  if (e.dataTransfer.files.length) enqueueFiles(e.dataTransfer.files);
                }}
              >
                <div className={s.dropIcon} aria-hidden="true">
                  <UploadIcon />
                </div>
                <div>
                  <div className={s.dropTitle}>
                    {drag
                      ? 'Let go to upload'
                      : awaiting
                        ? 'Waiting for your photos…'
                        : wide
                          ? 'Drop photos & videos here'
                          : 'Choose photos & videos'}
                  </div>
                  <div className={s.dropSub}>
                    {awaiting
                      ? IS_IOS
                        ? 'After you tap Add, iPhone prepares the originals first. Big photos and videos can take a minute.'
                        : 'Pick them in the window that opened.'
                      : wide
                        ? 'or click to browse'
                        : 'Tap to open your library'}
                  </div>
                </div>
              </button>
            )}
            {awaiting && (
              <button type="button" className={s.filesLink} onClick={() => setAwaiting(false)}>
                Cancel
              </button>
            )}

            {IS_TOUCH && !IS_IOS && !awaiting && !disk?.uploadsBlocked && (
              <div className={s.filesPick}>
                <button type="button" className={s.filesLink} onClick={() => openPicker(FILES_ACCEPT)}>
                  Keep locations: pick from Files
                </button>
                <div className={s.filesHint}>The gallery removes where photos were taken. In Files, open DCIM › Camera.</div>
              </div>
            )}

            <div className={s.notes}>
              <div className={s.notesCaps}>HEIC · JPG · RAW · MOV · MP4 — ORIGINALS, NEVER COMPRESSED</div>
              <div className={s.notesBody}>Date, time, camera and location are read from each file and used to sort it into the right day.</div>
            </div>
            {disk?.lowSpace && !disk.uploadsBlocked && (
              <div className={s.lowSpace}>
                <WarningIcon aria-hidden />
                Storage is getting low on the server.
              </div>
            )}
          </>
        )}

        {stage === 'progress' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className={s.big}>
              {pct}
              <span className={s.bigPct}>%</span>
            </div>
            <div className={s.overallBar}>
              <div className={s.overallFill} style={{ width: `${pct}%` }} />
            </div>
            <div className={s.overallLine}>
              <span>
                {activeDone} of {entries.length} done · {formatBytes(activeSent)} of {formatBytes(activeTotal)}
              </span>
            </div>
          </div>
        )}

        {stage === 'done' && (
          <div className={s.doneWrap}>
            <div className={s.doneCheck} aria-hidden="true">
              <CheckIcon />
            </div>
            <div className={s.doneTitle}>{doneTitle}</div>
            <div className={s.doneBody}>
              {newCount === 0
                ? 'Nothing new to add. These files were uploaded before, so they were skipped.'
                : `Full resolution, attributed to ${person?.name ?? 'you'}. ${sortedLine}`}
            </div>
          </div>
        )}

        {entries.length > 0 && (
          <div className={s.list}>
            {entries.map((e) => (
              <UploadRow key={e.clientId} entry={e} onRetry={(id) => openPicker(PICKER_ACCEPT, id)} />
            ))}
          </div>
        )}

        {stage === 'progress' && (
          <div className={s.hint}>
            {inBackground
              ? 'You can leave the app. Uploads keep going in the background; your phone shows their progress in a notification.'
              : IS_IOS
                ? 'Keep Øresund open until it’s done. iPhone pauses uploads when you leave Safari; they continue when you come back.'
                : 'You can close this. Keep Øresund open until it’s done.'}
          </div>
        )}

        {stage === 'done' && (
          <div className={s.actions}>
            <button type="button" className={s.primary} onClick={viewInLibrary}>
              View in library
            </button>
            <button type="button" className={s.secondary} onClick={addMore}>
              Add more
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
