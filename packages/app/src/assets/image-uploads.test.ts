import { describe, expect, it } from 'vitest';

import type { AssetId, ObjectId } from '@canvas/schema';

import { ImageUploads, MAX_CONCURRENT_UPLOADS, type RunImageUpload } from './image-uploads.js';
import type { PreparedImage } from './prepare-image.js';
import type { UploadEvent } from './upload-state.js';

/**
 * A prepared image with a made-up id.
 *
 * @param name - Makes the id differ.
 * @returns The image.
 */
function image(name: string): PreparedImage {
  return {
    assetId: name.padEnd(64, '0') as AssetId,
    naturalSize: { width: 1, height: 1 },
    mimeType: 'image/png',
    byteLength: 1,
  };
}

/**
 * Uploads whose runs the test finishes by hand.
 *
 * @returns The uploads, their runs, what verified and a change count.
 */
function setUp() {
  const runs: {
    assetId: AssetId;
    emit: (event: UploadEvent) => void;
    finish: () => void;
    signal: AbortSignal;
  }[] = [];
  const verified: AssetId[] = [];
  const forgotten: AssetId[] = [];
  const run: RunImageUpload = (prepared, file, onEvent, signal) =>
    new Promise((resolve) => {
      runs.push({ assetId: prepared.assetId, emit: onEvent, finish: resolve, signal });
    });
  const uploads = new ImageUploads(
    run,
    (assetId) => verified.push(assetId),
    (assetId) => forgotten.push(assetId),
  );
  let changes = 0;
  uploads.subscribe(() => (changes += 1));
  return { uploads, runs, verified, forgotten, changes: () => changes };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ImageUploads', () => {
  it('runs at most three uploads at once, starting the next as one ends', async () => {
    const { uploads, runs } = setUp();
    for (const name of ['a', 'b', 'c', 'd'])
      uploads.add(image(name), new Blob([]), [name as ObjectId]);
    expect(runs).toHaveLength(MAX_CONCURRENT_UPLOADS);
    runs[0]?.emit({ type: 'start' });
    runs[0]?.emit({ type: 'error', message: 'Offline.' });
    runs[0]?.finish();
    await settle();
    expect(runs).toHaveLength(4);
    expect(uploads.snapshot().map(({ state }) => state.phase)).toEqual([
      'failed',
      'queued',
      'queued',
      'queued',
    ]);
  });

  it('uploads one asset once, however many objects show it', () => {
    const { uploads, runs } = setUp();
    uploads.add(image('a'), new Blob([]), ['one' as ObjectId]);
    uploads.add(image('a'), new Blob([]), ['two' as ObjectId]);
    expect(runs).toHaveLength(1);
    expect(uploads.snapshot()[0]?.objectIds).toEqual(['one', 'two']);
    // It remembers what it began uploading, after the upload is forgotten too.
    uploads.forget(image('a').assetId);
    expect(uploads.hasAdded(image('a').assetId)).toBe(true);
    expect(uploads.hasAdded(image('b').assetId)).toBe(false);
  });

  it('tells when the bytes verified, follows the adapter’s records and drops a ready upload', () => {
    const { uploads, runs, verified, changes } = setUp();
    const { assetId } = image('a');
    uploads.add(image('a'), new Blob([]), []);
    const run = runs[0];
    uploads.record(assetId, 'processing', 0.2);
    expect(uploads.snapshot()[0]?.state.phase).toBe('queued');
    run?.emit({ type: 'start' });
    run?.emit({ type: 'sent-all' });
    run?.emit({ type: 'record', status: 'processing', progress: 0 });
    expect(verified).toEqual([assetId]);
    uploads.record(assetId, 'processing', 0.5);
    expect(uploads.snapshot()[0]?.state).toMatchObject({ phase: 'processing', progress: 0.5 });
    const before = changes();
    uploads.record(assetId, 'processing', 0.5);
    expect(changes()).toBe(before);
    uploads.record(assetId, 'ready', 1);
    expect(uploads.snapshot()).toEqual([]);
    uploads.record(assetId, 'ready', 1);
  });

  it('retries a failed upload, and only a failed one', async () => {
    const { uploads, runs } = setUp();
    const { assetId } = image('a');
    uploads.add(image('a'), new Blob([]), []);
    uploads.retry(assetId);
    runs[0]?.emit({ type: 'error', message: 'Busy.' });
    runs[0]?.finish();
    await settle();
    uploads.retry(assetId);
    expect(runs).toHaveLength(2);
    expect(uploads.snapshot()[0]?.state.phase).toBe('queued');
    uploads.retry('z'.repeat(64) as AssetId);
  });

  it('forgets an upload whose objects were removed', () => {
    const { uploads } = setUp();
    uploads.add(image('a'), new Blob([]), []);
    uploads.forget(image('a').assetId);
    uploads.forget(image('a').assetId);
    expect(uploads.snapshot()).toEqual([]);
  });

  it('lets a forgotten upload’s bytes go, the adapter told', () => {
    const { uploads, runs, forgotten } = setUp();
    uploads.add(image('a'), new Blob([]), ['a' as ObjectId]);
    runs[0]?.emit({ type: 'start' });
    runs[0]?.emit({ type: 'error', message: 'Offline.' });
    uploads.forget(image('a').assetId);
    uploads.forget(image('a').assetId);
    expect(forgotten).toEqual([image('a').assetId]);
    expect(uploads.snapshot()).toEqual([]);
  });

  it('stops every running upload and drops them all when destroyed', async () => {
    const { uploads, runs } = setUp();
    for (const name of ['a', 'b', 'c', 'd']) {
      uploads.add(image(name), new Blob([]), [name as ObjectId]);
    }
    uploads.destroy();
    expect(runs.map(({ signal }) => signal.aborted)).toEqual([true, true, true]);
    // A stopped run's late events change nothing, and no queued upload starts.
    runs[0]?.emit({ type: 'start' });
    runs[0]?.finish();
    await settle();
    expect(runs).toHaveLength(3);
    expect(uploads.snapshot()).toEqual([]);
  });

  it('cancels a running upload: its run is stopped, it is forgotten, and the next one starts', async () => {
    const { uploads, runs, forgotten } = setUp();
    for (const name of ['a', 'b', 'c', 'd']) {
      uploads.add(image(name), new Blob(['12345']), [name as ObjectId]);
    }
    expect(uploads.snapshot()[0]?.byteLength).toBe(5);
    runs[0]?.emit({ type: 'start' });
    uploads.cancel(image('a').assetId);
    expect(runs[0]?.signal.aborted).toBe(true);
    expect(forgotten).toEqual([image('a').assetId]);
    expect(uploads.snapshot().map(({ assetId }) => assetId[0])).toEqual(['b', 'c', 'd']);
    // A stopped run's late events change nothing; its slot goes to the next once it settles.
    runs[0]?.emit({ type: 'error', message: 'Stopped.' });
    expect(runs).toHaveLength(3);
    runs[0]?.finish();
    await settle();
    expect(runs.map(({ assetId }) => assetId[0])).toEqual(['a', 'b', 'c', 'd']);
    // A queued one never starts; an unknown one is nothing.
    uploads.add(image('e'), new Blob([]), ['e' as ObjectId]);
    uploads.cancel(image('e').assetId);
    uploads.cancel('z'.repeat(64) as AssetId);
    runs[1]?.finish();
    await settle();
    expect(runs.some(({ assetId }) => assetId.startsWith('e'))).toBe(false);
  });

  it('retries every failed upload at once, and nothing else', async () => {
    const { uploads, runs } = setUp();
    for (const name of ['a', 'b', 'c']) uploads.add(image(name), new Blob([]), []);
    for (const run of runs.slice(0, 2)) {
      run.emit({ type: 'start' });
      run.emit({ type: 'error', message: 'Offline.' });
      run.finish();
    }
    await settle();
    expect(uploads.snapshot().map(({ state }) => state.phase)).toEqual([
      'failed',
      'failed',
      'queued',
    ]);
    uploads.retryFailed();
    expect(uploads.snapshot().map(({ state }) => state.phase)).toEqual([
      'queued',
      'queued',
      'queued',
    ]);
    expect(runs).toHaveLength(5);
  });
});
