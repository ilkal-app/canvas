import { describe, expect, it, vi } from 'vitest';

import type { AssetId } from '@canvas/schema';

import { AssetsHttpError } from './assets-responses.js';
import { ImageAvailabilityCheck } from './image-availability.js';

const ASSET = 'a'.repeat(64) as AssetId;

describe('ImageAvailabilityCheck', () => {
  it('calls an asset the board reads available, and remembers it', async () => {
    const readRecord = vi.fn(() => Promise.resolve({}));
    const check = new ImageAvailabilityCheck({ readRecord, isUploading: () => false });
    expect(await check.availabilityOf(ASSET)).toBe('available');
    expect(await check.availabilityOf(ASSET)).toBe('available');
    expect(readRecord).toHaveBeenCalledTimes(1);
  });

  it('reads a record through the board’s reader', async () => {
    const record = { averageColor: [0, 0, 0, 1] };
    const readRecord = vi.fn(() => Promise.resolve(record));
    const check = new ImageAvailabilityCheck({ readRecord, isUploading: () => false });
    expect(await check.readRecord(ASSET)).toBe(record);
    expect(readRecord).toHaveBeenCalledWith(ASSET);
  });

  it('calls a 404 missing (asked again next time), other failures unknown, and asks nothing of an upload', async () => {
    const readRecord = vi
      .fn<(assetId: AssetId) => Promise<unknown>>()
      .mockRejectedValueOnce(new AssetsHttpError(404, 'not-found', 'x'))
      .mockRejectedValueOnce(new AssetsHttpError(0, 'network', 'x'))
      .mockRejectedValueOnce(new Error('x'));
    let isUploading = false;
    const check = new ImageAvailabilityCheck({ readRecord, isUploading: () => isUploading });
    expect(await check.availabilityOf(ASSET)).toBe('missing');
    expect(await check.availabilityOf(ASSET)).toBe('unknown');
    expect(await check.availabilityOf(ASSET)).toBe('unknown');
    isUploading = true;
    expect(await check.availabilityOf(ASSET)).toBe('uploading');
    expect(readRecord).toHaveBeenCalledTimes(3);
  });

  it('calls a 404 unfinished only for an asset this page began uploading', async () => {
    const readRecord = vi.fn(() => Promise.reject(new AssetsHttpError(404, 'not-found', 'x')));
    const ours = new ImageAvailabilityCheck({
      readRecord,
      isUploading: () => false,
      hasUploaded: (assetId) => assetId === ASSET,
    });
    expect(await ours.availabilityOf(ASSET)).toBe('unfinished');
    expect(await ours.availabilityOf('b'.repeat(64) as AssetId)).toBe('missing');
  });
});
