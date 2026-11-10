// PR 1: the document reader keeps an image paint, including on a replay.
import { describe, expect, it } from 'vitest';

import { tolerateStoredPaints } from './paint-tolerance.js';

const PAINT = {
  type: 'image',
  assetId: 'asset-photo',
  naturalSize: { width: 1600, height: 900 },
  fit: 'crop',
  crop: { x: 0, y: 0, width: 1, height: 1 },
};

describe('image paint tolerance', () => {
  it('keeps shape fill and frame background values exactly', () => {
    const target: Record<string, unknown> = { fill: PAINT, background: PAINT };
    tolerateStoredPaints(target);
    expect(target).toEqual({ fill: PAINT, background: PAINT });
  });
});
