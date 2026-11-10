// PR 3: abandoning an image fill's upload clears the fill, never the shape.
import { describe, expect, it } from 'vitest';

import type { AssetId, BoardObject, ObjectId } from '@canvas/schema';

import { uploadRemovalOf } from './upload-removal.js';

const ASSET = 'a'.repeat(64) as AssetId;
const OTHER = 'b'.repeat(64) as AssetId;

const fill = (assetId: AssetId) => ({
  type: 'image',
  assetId,
  naturalSize: { width: 10, height: 10 },
  fit: 'crop',
  crop: { x: 0, y: 0, width: 1, height: 1 },
});

function reader(objects: readonly Record<string, unknown>[]) {
  const map = new Map(objects.map((object) => [object.id as ObjectId, object as BoardObject]));
  return { get: (id: ObjectId) => map.get(id) };
}

describe('uploadRemovalOf', () => {
  it('deletes the asset’s images and clears the asset’s fills and backgrounds', () => {
    const board = reader([
      { id: 'photo', type: 'image', assetId: ASSET },
      { id: 'card', type: 'shape', fill: fill(ASSET) },
      { id: 'panel', type: 'frame', background: fill(ASSET) },
    ]);
    expect(uploadRemovalOf(board, ASSET, ['photo', 'card', 'panel'] as ObjectId[])).toEqual({
      deleted: ['photo'],
      cleared: [
        { id: 'card', style: { fill: null } },
        { id: 'panel', style: { background: null } },
      ],
    });
  });

  it('deletes every named image and passes a gone id on, as before image fills', () => {
    const board = reader([{ id: 'photo', type: 'image', assetId: OTHER }]);
    expect(uploadRemovalOf(board, ASSET, ['photo', 'gone'] as ObjectId[])).toEqual({
      deleted: ['photo', 'gone'],
      cleared: [],
    });
  });

  it('leaves alone a fill that shows another asset now, and what cannot show one', () => {
    const board = reader([
      { id: 'card', type: 'shape', fill: [1, 0, 0, 1] },
      { id: 'swapped', type: 'shape', fill: fill(OTHER) },
      { id: 'panel', type: 'frame', background: null },
      { id: 'card-copy', type: 'instance' },
    ]);
    const ids = ['card', 'swapped', 'panel', 'card-copy'] as ObjectId[];
    expect(uploadRemovalOf(board, ASSET, ids)).toEqual({ deleted: [], cleared: [] });
  });
});
