import { describe, expect, it, vi } from 'vitest';

import type { AssetId, AssetRecord } from '@canvas/schema';

import { AssetsHttpError } from './assets-responses.js';
import { linkedImageSize, linkProblemMessage } from './link-images.js';

const id = 'a'.repeat(64) as AssetId;

const record: AssetRecord = {
  id,
  mimeType: 'image/png',
  byteLength: 3,
  status: 'processing',
  naturalSize: null,
  levels: [],
  tiles: null,
  blurhash: null,
  averageColor: null,
  progress: 0,
  createdAt: 0,
};

describe('linkProblemMessage', () => {
  it('says what each refusal means', () => {
    expect(linkProblemMessage(new AssetsHttpError(400, 'private-address', ''))).toBe(
      'That link points inside a private network.',
    );
    expect(linkProblemMessage(new AssetsHttpError(413, 'too-large', ''))).toBe(
      'That image is larger than 25 MB.',
    );
  });

  it('falls back to one sentence for an unknown code or another error', () => {
    expect(linkProblemMessage(new AssetsHttpError(500, 'what', ''))).toBe(
      'That image could not be added.',
    );
    expect(linkProblemMessage(new Error('boom'))).toBe('That image could not be added.');
  });
});

describe('linkedImageSize', () => {
  it('gives the record’s size without asking', async () => {
    const events = vi.fn();
    const size = await linkedImageSize(
      { events },
      { ...record, naturalSize: { width: 4, height: 3 } },
    );
    expect(size).toEqual({ width: 4, height: 3 });
    expect(events).not.toHaveBeenCalled();
  });

  it('waits for the first size the events give and stops following them', async () => {
    let signal: AbortSignal | undefined;
    const size = await linkedImageSize(
      {
        events: (assetIdOf, onRecord, stop) => {
          signal = stop;
          onRecord(record);
          onRecord({ ...record, status: 'ready', naturalSize: { width: 8, height: 6 } });
          return Promise.resolve();
        },
      },
      record,
    );
    expect(size).toEqual({ width: 8, height: 6 });
    expect(signal?.aborted).toBe(true);
  });

  it('gives nothing when the asset fails', async () => {
    const size = await linkedImageSize(
      {
        events: (assetIdOf, onRecord) => {
          onRecord({ ...record, status: 'failed' });
          return Promise.reject(new Error('aborted'));
        },
      },
      record,
    );
    expect(size).toBeUndefined();
  });

  it('gives nothing once the wait ends', async () => {
    const size = await linkedImageSize(
      {
        events: (assetIdOf, onRecordOf, stop) =>
          new Promise((resolveNever, reject) => {
            stop?.addEventListener('abort', () => {
              reject(new Error('aborted'));
            });
          }),
      },
      record,
      5,
    );
    expect(size).toBeUndefined();
  });
});
