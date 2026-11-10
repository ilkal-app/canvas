import { describe, expect, it } from 'vitest';

import type { AssetId } from '@canvas/schema';

import type { DecodedLevel } from '../workers/job-kinds.js';
import type { JobPriority } from '../workers/job-priority.js';

import type { Want } from './image-needs.js';
import { UploadQueue, type UploadOutcome } from './upload-queue.js';

/**
 * A blank square level.
 *
 * @param edgePx - Its edge, px.
 * @returns The level.
 */
function level(edgePx: number): DecodedLevel {
  return { widthPx: edgePx, heightPx: edgePx, rgba: new Uint8Array(edgePx * edgePx * 4) };
}

/**
 * The frame's wants, by key.
 *
 * @param entries - Each key and its priority.
 * @returns The wants.
 */
function wantsOf(entries: readonly [string, JobPriority][]): Map<string, Want> {
  const source = { kind: 'server', assetId: 'photo' as AssetId, longEdgePx: 128 } as const;
  return new Map(
    entries.map(([key, priority]) => [key, { key, source, priority, isNeeded: true }]),
  );
}

describe('UploadQueue', () => {
  it('drops levels no longer wanted and uploads the most urgent first, smaller before larger', () => {
    const queue = new UploadQueue(64 * 1024 * 1024);
    queue.add('prefetched', level(128));
    queue.add('visible large', level(512));
    queue.add('visible small', level(128));
    queue.add('gone', level(128));
    const order: string[] = [];

    const isDeferred = queue.flush(
      wantsOf([
        ['prefetched', 'prefetch'],
        ['visible large', 'visible'],
        ['visible small', 'visible'],
      ]),
      (key) => {
        order.push(key);
        return 'uploaded';
      },
    );

    expect(order).toEqual(['visible small', 'visible large', 'prefetched']);
    expect([isDeferred, queue.size]).toEqual([false, 0]);
  });

  it('keeps a level the budget refused, and drops one the GPU could not allocate', () => {
    const queue = new UploadQueue(64 * 1024 * 1024);
    queue.add('refused', level(128));
    queue.add('failed', level(128));
    const outcomes: Record<string, UploadOutcome> = {
      refused: 'over-budget',
      failed: 'allocation-failed',
    };

    queue.flush(
      wantsOf([
        ['refused', 'visible'],
        ['failed', 'visible'],
      ]),
      (key) => outcomes[key] ?? 'uploaded',
    );

    expect([queue.has('refused'), queue.has('failed')]).toEqual([true, false]);
  });

  it('holds the rest back once a frame has uploaded its bytes, always uploading the first', () => {
    const queue = new UploadQueue(1024);
    queue.add('a', level(64));
    queue.add('b', level(64));

    const isDeferred = queue.flush(
      wantsOf([
        ['a', 'visible'],
        ['b', 'visible'],
      ]),
      () => 'uploaded',
    );

    expect([isDeferred, queue.size]).toEqual([true, 1]);
  });

  it('drops a level whose upload was kept back for a resident one, and keeps a refused one', () => {
    const queue = new UploadQueue(64 * 1024 * 1024);
    queue.add('kept', level(128));
    queue.add('refused', level(128));
    const outcomes: Record<string, UploadOutcome> = { kept: 'kept', refused: 'over-budget' };

    queue.flush(
      wantsOf([
        ['kept', 'visible'],
        ['refused', 'visible'],
      ]),
      (key) => outcomes[key] ?? 'uploaded',
    );

    expect(queue.has('kept')).toBe(false);
    expect(queue.has('refused')).toBe(true);
  });
});
