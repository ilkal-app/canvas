// PR 1: a cross-board paste links assets used by image-filled shapes and frames.
import { describe, expect, it } from 'vitest';

import { createBoard, type AssetId, type Paint } from '@canvas/schema';

import { clipboardBoard, objectOf } from './__fixtures__/clipboard-board.js';
import { createLinkedPaste, imageAssetsOf } from './linked-paste.js';
import type { PasteTarget } from './paste-handlers.js';

const ASSET = 'fill-photo' as AssetId;
const PAINT = {
  type: 'image',
  assetId: ASSET,
  naturalSize: { width: 1600, height: 900 },
  fit: 'fit',
  crop: { x: 0, y: 0, width: 1, height: 1 },
} as unknown as Paint;

function filledBoard() {
  const fixture = clipboardBoard();
  const shape = objectOf(fixture, 'outside');
  const frame = objectOf(fixture, 'frame');
  if (shape.type !== 'shape' || frame.type !== 'frame') throw new Error('fixture types changed');
  return createBoard([
    { ...shape, fill: PAINT },
    { ...frame, background: PAINT },
  ]);
}

describe('linked paste of image paints', () => {
  it('links the shared fill asset before creating on another board', async () => {
    const board = filledBoard();
    expect(imageAssetsOf(board)).toEqual([ASSET]);
    const links: AssetId[][] = [];
    let didCreate = false;
    const target: PasteTarget = {
      boardId: 'destination',
      sourceBoard: 'source',
      pointer: undefined,
      viewCentre: { x: 0, y: 0 },
      createObjects: () => true,
      notify: () => undefined,
      images: {
        insert: () => undefined,
        wasCopiedFrom: () => true,
        linkFrom: (assets) => {
          links.push([...assets]);
          expect(didCreate).toBe(false);
          return Promise.resolve();
        },
      },
    };
    createLinkedPaste(board, [], target, () => {
      didCreate = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(links).toEqual([[ASSET]]);
    expect(didCreate).toBe(true);
  });
});
