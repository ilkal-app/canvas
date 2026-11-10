// PR 1: restored projections preload assets referenced by image paints.
import { describe, expect, it } from 'vitest';

import { type AssetId, type Paint } from '@canvas/schema';

import { clipboardBoard, objectOf } from '../clipboard/__fixtures__/clipboard-board.js';

import { projectionAssetIds } from './instance-projection.js';

const ASSET = 'fill-photo' as AssetId;
const PAINT = {
  type: 'image',
  assetId: ASSET,
  naturalSize: { width: 1600, height: 900 },
  fit: 'tile',
  crop: { x: 0, y: 0, width: 1, height: 1 },
} as unknown as Paint;

describe('projectionAssetIds with image paints', () => {
  it('includes shape and frame references once beside an image object', () => {
    const board = clipboardBoard();
    const shape = objectOf(board, 'outside');
    const frame = objectOf(board, 'frame');
    const image = objectOf(board, 'photo');
    if (shape.type !== 'shape' || frame.type !== 'frame') throw new Error('fixture types changed');
    expect(
      projectionAssetIds([{ ...shape, fill: PAINT }, { ...frame, background: PAINT }, image]),
    ).toEqual(new Set([ASSET, 'asset-photo']));
  });
});
