// Fill crop mode against a collaborator's edits: the commit
// reads the fill as stored when it commits, so a fit changed meanwhile is kept, and a crop of an
// image replaced or removed meanwhile writes nothing.
import { describe, expect, it } from 'vitest';

import { YjsDocumentStore } from '@canvas/document';
import type { AssetId, BoardObject, ImagePaint, ObjectId } from '@canvas/schema';

import { rect } from '../select/__fixtures__/select-board.js';
import { ADA, NOW } from '../select/__fixtures__/select-store.js';
import type { OrientedBox } from '../select/oriented-box.js';

import type { CropModeContext } from './crop-mode.js';
import { fillCropModeOf } from './fill-crop-mode.js';

const PAINT: ImagePaint = {
  type: 'image',
  assetId: 'a'.repeat(64) as AssetId,
  naturalSize: { width: 400, height: 300 },
  fit: 'fill',
  crop: { x: 0, y: 0, width: 1, height: 1 },
};
const BOX: OrientedBox = { x: 100, y: 200, width: 240, height: 160, rotation: 0 };

/**
 * A shape filled with the image in crop mode, a draft crop narrowed by a nudge.
 *
 * @returns The store, the shape and the mode.
 * @throws {Error} When the shape enters no crop mode.
 */
function cropping() {
  const shape = { ...rect('target', null, BOX), fill: PAINT } as BoardObject;
  const store = new YjsDocumentStore();
  store.transact(ADA, (transaction) => {
    transaction.setObject(shape);
  });
  const context: CropModeContext = {
    store,
    origin: ADA,
    environment: { clock: () => NOW, createId: () => 'whole' as ObjectId },
    setPreview: () => undefined,
    onChange: () => undefined,
    requestExit: () => undefined,
  };
  if (shape.type !== 'shape') throw new Error('not a shape');
  const mode = fillCropModeOf(context, shape, BOX);
  if (mode === undefined) throw new Error('no crop mode');
  mode.onKey({ kind: 'nudge', direction: 'left', isLarge: true });
  const collaborator = (fill: unknown) => {
    store.transact(ADA, (transaction) => {
      transaction.setObject({ ...shape, fill } as BoardObject);
    });
  };
  return { store, shape, mode, collaborator };
}

describe('fill crop mode and a collaborator', () => {
  it('keeps a fit changed meanwhile and writes only the crop', () => {
    const { store, shape, mode, collaborator } = cropping();
    collaborator({ ...PAINT, fit: 'tile' });
    const { crop } = mode;
    mode.exit();
    expect(store.get(shape.id)).toMatchObject({ fill: { ...PAINT, fit: 'tile', crop } });
  });

  it('writes nothing when the image was replaced or the fill is no longer an image', () => {
    for (const fill of [{ ...PAINT, assetId: 'b'.repeat(64) }, [1, 0, 0, 1]]) {
      const { store, shape, mode, collaborator } = cropping();
      collaborator(fill);
      mode.exit();
      expect(store.get(shape.id)).toMatchObject({ fill });
    }
  });
});
