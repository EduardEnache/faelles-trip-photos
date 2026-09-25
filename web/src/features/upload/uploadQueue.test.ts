import { describe, expect, it } from 'vitest';
import { stageOf, type QueueEntry } from './uploadQueue';

function entry(status: QueueEntry['status']): QueueEntry {
  return {
    clientId: 'c',
    name: 'a.jpg',
    size: 100,
    lastModified: 0,
    mime: 'image/jpeg',
    status,
    bytesSent: 0,
    message: null,
    itemId: null,
    day: null,
    duplicate: false,
    addedAt: 0,
  };
}

describe('uploadQueue: stageOf (upload sheet state machine)', () => {
  it('no entries -> pick', () => {
    expect(stageOf([])).toBe('pick');
  });

  it.each(['queued', 'uploading', 'waiting', 'needs-file'] as const)(
    'any entry still %s -> progress',
    (status) => {
      expect(stageOf([entry(status)])).toBe('progress');
    },
  );

  it.each(['done', 'duplicate', 'error', 'unsupported'] as const)(
    'all entries terminal (%s) -> done',
    (status) => {
      expect(stageOf([entry(status)])).toBe('done');
    },
  );

  it('one active among several terminal entries keeps the sheet in progress', () => {
    expect(stageOf([entry('done'), entry('error'), entry('uploading')])).toBe('progress');
  });

  it('a mix of only terminal statuses is done, regardless of which ones', () => {
    expect(stageOf([entry('done'), entry('duplicate'), entry('error'), entry('unsupported')])).toBe('done');
  });
});
