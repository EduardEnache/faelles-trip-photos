/**
 * one row in the upload sheet's file list.
 */
import { formatBytes } from '@shared/format';
import { sectionTitle } from '@shared/trip';
import { CheckIcon, DuplicateIcon, OfflineIcon, PendingIcon, PhotoIcon, RetryIcon, VideoIcon, WarningIcon } from '@/lib/icons';
import { IconButton } from '@/ui';
import type { QueueEntry } from './uploadQueue';
import s from './UploadRow.module.css';

function kindIcon(mime: string) {
  return mime.startsWith('video/') ? <VideoIcon /> : <PhotoIcon />;
}

export function UploadRow({ entry, onRetry }: { entry: QueueEntry; onRetry: (clientId: string) => void }) {
  const pct = entry.size ? Math.min(1, entry.bytesSent / entry.size) : 0;
  const pctLabel = Math.round(pct * 100);

  const meta =
    entry.status === 'duplicate'
      ? 'Already in the album'
      : entry.status === 'done'
        ? entry.day
          ? `Sorted into ${sectionTitle(entry.day)}`
          : 'Sorted by capture date'
        : entry.status === 'error' || entry.status === 'unsupported'
        ? entry.message ?? 'Something went wrong'
        : entry.status === 'waiting'
          ? entry.message ?? 'Waiting for connection'
          : entry.status === 'needs-file'
            ? entry.message ?? 'Tap to add this file again'
            : entry.status === 'background'
              ? 'Uploading in the background'
              : entry.message ?? 'Reading date and location…';

  const statusLabel =
    entry.status === 'done'
      ? null
      : entry.status === 'duplicate'
        ? null
        : entry.status === 'error' || entry.status === 'unsupported'
          ? '—'
          : entry.status === 'waiting'
            ? '···'
            : entry.status === 'needs-file'
              ? '—'
              : `${pctLabel}%`;

  const barClass = [s.barFill, entry.status === 'done' && s.done, (entry.status === 'error' || entry.status === 'unsupported') && s.error]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={s.row}>
      <div className={s.thumb} aria-hidden="true">
        {entry.status === 'waiting' ? <OfflineIcon /> : kindIcon(entry.mime)}
      </div>
      <div className={s.body}>
        <div className={s.top}>
          <span className={s.name}>{entry.name}</span>
          <span className={s.size}>{formatBytes(entry.size)}</span>
        </div>
        <div className={s.meta}>{meta}</div>
        <div className={s.bar}>
          <div className={barClass} style={{ width: `${entry.status === 'done' || entry.status === 'duplicate' ? 100 : Math.round(pct * 100)}%` }} />
        </div>
      </div>
      {entry.status === 'done' && (
        <span className={[s.status, s.done].join(' ')} aria-label="Done">
          <CheckIcon />
        </span>
      )}
      {entry.status === 'duplicate' && (
        <span className={[s.status, s.done].join(' ')} aria-label="Already in the album">
          <DuplicateIcon />
        </span>
      )}
      {(entry.status === 'error' || entry.status === 'needs-file') && (
        <IconButton label={entry.status === 'needs-file' ? 'Add this file again' : 'Retry'} tone="plain" className={s.retry} onClick={() => onRetry(entry.clientId)}>
          <RetryIcon />
        </IconButton>
      )}
      {entry.status === 'unsupported' && (
        <span className={[s.status, s.error].join(' ')} aria-label="Not supported">
          <WarningIcon />
        </span>
      )}
      {(entry.status === 'queued' || entry.status === 'uploading' || entry.status === 'waiting' || entry.status === 'background') && (
        <span className={s.status}>{statusLabel === '···' ? <PendingIcon /> : statusLabel}</span>
      )}
    </div>
  );
}
