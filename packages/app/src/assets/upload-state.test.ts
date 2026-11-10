import { describe, expect, it } from 'vitest';

import {
  isUploadActive,
  PROCESSING_FAILED_MESSAGE,
  QUEUED_UPLOAD,
  stepUpload,
  uploadBytesLabel,
  type UploadEvent,
  type UploadState,
} from './upload-state.js';

/**
 * Runs events from the queued state.
 *
 * @param events - The events, in order.
 * @returns The state after them.
 */
function run(...events: UploadEvent[]): UploadState {
  return events.reduce(stepUpload, QUEUED_UPLOAD);
}

describe('stepUpload', () => {
  it('goes queued → uploading → completing → processing → ready with its progress', () => {
    expect(run({ type: 'start' })).toEqual({ phase: 'uploading', progress: 0, attempts: 1 });
    expect(run({ type: 'start' }, { type: 'sent', loaded: 25, total: 100 })).toMatchObject({
      phase: 'uploading',
      progress: 0.25,
    });
    const verifying = run({ type: 'start' }, { type: 'sent-all' });
    expect(verifying).toEqual({ phase: 'completing', progress: 1, attempts: 1 });
    const processing = stepUpload(verifying, {
      type: 'record',
      status: 'processing',
      progress: 0.4,
    });
    expect(processing).toEqual({ phase: 'processing', progress: 0.4, attempts: 1 });
    expect(stepUpload(processing, { type: 'record', status: 'ready', progress: 1 })).toEqual({
      phase: 'ready',
      progress: 1,
      attempts: 1,
    });
  });

  it('reads an uploading record after the completion as processing about to start', () => {
    const state = run(
      { type: 'start' },
      { type: 'sent-all' },
      { type: 'record', status: 'uploading', progress: 0 },
    );
    expect(state.phase).toBe('processing');
  });

  it('fails with the reason from any active phase, and a retry queues it again', () => {
    for (const events of [
      [] as UploadEvent[],
      [{ type: 'start' }],
      [{ type: 'start' }, { type: 'sent-all' }],
    ] as UploadEvent[][]) {
      const failed = run(...events, { type: 'error', message: 'Offline.' });
      expect(failed).toMatchObject({ phase: 'failed', failure: 'Offline.' });
      expect(isUploadActive(failed)).toBe(false);
      const again = stepUpload(failed, { type: 'retry' });
      expect(again).toEqual({ ...QUEUED_UPLOAD, attempts: failed.attempts });
      expect(stepUpload(again, { type: 'start' }).attempts).toBe(failed.attempts + 1);
    }
  });

  it('fails when the service could not process the image', () => {
    const state = run(
      { type: 'start' },
      { type: 'sent-all' },
      { type: 'record', status: 'failed', progress: 0.5 },
    );
    expect(state).toMatchObject({ phase: 'failed', failure: PROCESSING_FAILED_MESSAGE });
  });

  it('ignores events that do not apply where the upload stands', () => {
    const ready = run(
      { type: 'start' },
      { type: 'sent-all' },
      { type: 'record', status: 'ready', progress: 1 },
    );
    for (const event of [
      { type: 'start' },
      { type: 'sent', loaded: 1, total: 2 },
      { type: 'sent-all' },
      { type: 'record', status: 'failed', progress: 0 },
      { type: 'error', message: 'late' },
      { type: 'retry' },
    ] as UploadEvent[]) {
      expect(stepUpload(ready, event)).toBe(ready);
    }
    expect(stepUpload(QUEUED_UPLOAD, { type: 'record', status: 'ready', progress: 1 })).toBe(
      QUEUED_UPLOAD,
    );
    expect(run({ type: 'start' }, { type: 'sent', loaded: 1, total: 0 }).progress).toBe(0);
    expect(isUploadActive(QUEUED_UPLOAD)).toBe(true);
  });
});

describe('upload bytes', () => {
  it('keeps the bytes the put reported while uploading', () => {
    expect(run({ type: 'start' }, { type: 'sent', loaded: 3_200_000, total: 8_000_000 })).toEqual({
      phase: 'uploading',
      progress: 0.4,
      attempts: 1,
      sentBytes: 3_200_000,
      totalBytes: 8_000_000,
    });
    // An empty total sends nothing yet; a count past the total is the total.
    expect(run({ type: 'start' }, { type: 'sent', loaded: 0, total: 0 })).toMatchObject({
      progress: 0,
      sentBytes: 0,
    });
    expect(run({ type: 'start' }, { type: 'sent', loaded: 9, total: 4 })).toMatchObject({
      progress: 1,
      sentBytes: 4,
    });
  });

  it('says the bytes in megabytes, one decimal', () => {
    expect(uploadBytesLabel(3_200_000, 8_000_000)).toBe('3.2 of 8.0 MB');
    expect(uploadBytesLabel(0, 120_000)).toBe('0.0 of 0.1 MB');
    expect(uploadBytesLabel(9, 4)).toBe('0.0 of 0.0 MB');
    expect(uploadBytesLabel(-1, 25_000_000)).toBe('0.0 of 25.0 MB');
  });
});
