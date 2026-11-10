import { describe, expect, it, vi } from 'vitest';

import type { AssetId, BoardObject } from '@canvas/schema';
import { chooseDefaultInk } from '@canvas/tools';

import { AVERAGE_COLOR_RETRY_MS, ImageAverageColors } from './image-average-colors.js';

/**
 * Lets pending record reads settle.
 *
 * @returns Settles after them.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** An image 100 × 50 at the origin. */
const picture = {
  id: 'picture',
  type: 'image',
  parentId: null,
  x: 0,
  y: 0,
  rotation: 0,
  z: 'a0',
  locked: false,
  createdBy: 'user:ada',
  createdAt: 1,
  updatedAt: 1,
  width: 100,
  height: 50,
  assetId: 'asset-dark' as AssetId,
  crop: { x: 0, y: 0, width: 1, height: 1 },
  naturalSize: { width: 100, height: 50 },
  opacity: 1,
} as unknown as BoardObject;

describe('ImageAverageColors', () => {
  it('answers null until the record is read, then the record’s average colour', async () => {
    const readRecord = vi.fn(() => Promise.resolve({ averageColor: [0.1, 0.1, 0.1, 1] }));
    const colors = new ImageAverageColors({ readRecord });
    expect(colors.averageColorOf('asset-dark')).toBeNull();
    expect(colors.averageColorOf('asset-dark')).toBeNull();
    expect(readRecord).toHaveBeenCalledTimes(1);
    await settle();
    expect(colors.averageColorOf('asset-dark')).toEqual([0.1, 0.1, 0.1, 1]);
    expect(readRecord).toHaveBeenCalledTimes(1);
  });

  it('reads ahead when warmed, so the first press over the image finds its colour', async () => {
    const colors = new ImageAverageColors({
      readRecord: () => Promise.resolve({ averageColor: [0, 0, 0, 1] }),
    });
    colors.warm(['asset-dark']);
    await settle();
    const chosen = chooseDefaultInk({
      point: { x: 50, y: 25 },
      objects: [picture],
      theme: 'light',
      averageColorOf: colors.averageColorOf,
    });
    expect(chosen).toEqual([1, 1, 1, 1]);
  });

  it('keeps an image without an average pending (ink), and asks again only after a while', async () => {
    let nowMs = 0;
    const readRecord = vi.fn(() => Promise.resolve({ averageColor: null }));
    const colors = new ImageAverageColors({ readRecord, now: () => nowMs });
    expect(colors.averageColorOf('asset-dark')).toBeNull();
    await settle();
    const choose = () =>
      chooseDefaultInk({
        point: { x: 50, y: 25 },
        objects: [picture],
        theme: 'dark',
        averageColorOf: colors.averageColorOf,
      });
    expect(choose()).toBe('ink');
    expect(readRecord).toHaveBeenCalledTimes(1);
    nowMs = AVERAGE_COLOR_RETRY_MS;
    colors.averageColorOf('asset-dark');
    expect(readRecord).toHaveBeenCalledTimes(2);
  });

  it('treats a refused read or a malformed colour as unknown', async () => {
    const failing = new ImageAverageColors({ readRecord: () => Promise.reject(new Error('404')) });
    failing.warm(['a']);
    await settle();
    expect(failing.averageColorOf('a')).toBeNull();
    const malformed = new ImageAverageColors({
      readRecord: () => Promise.resolve({ averageColor: [2, 0, 0, 1] }),
    });
    malformed.warm(['b']);
    await settle();
    expect(malformed.averageColorOf('b')).toBeNull();
  });
});
