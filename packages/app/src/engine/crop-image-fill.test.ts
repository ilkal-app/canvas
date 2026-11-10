// Fill crop mode from the canvas action the paint control's "Crop image…" sends: the
// engine document starts it on the one selected image-filled shape through the tool router, and
// a viewer, another selection or a fill that is not an image starts nothing. In Chrome:
// tooling/scenario/specs/app/image-fill-crop.spec.ts.
import { describe, expect, it } from 'vitest';

import { createHistory } from '@canvas/document';
import type { AssetId, BoardObject, ImagePaint, ObjectId } from '@canvas/schema';
import { CropMode } from '@canvas/tools';

import { memoryShape } from '../panels/__fixtures__/memory-board.js';

import { createDemoDocument, LOCAL_USER_ORIGIN } from './demo-document.js';
import { EngineDocument } from './engine-document.js';

const PAINT: ImagePaint = {
  type: 'image',
  assetId: 'a'.repeat(64) as AssetId,
  naturalSize: { width: 400, height: 300 },
  fit: 'crop',
  crop: { x: 0, y: 0, width: 1, height: 1 },
};
const FILLED = 'filled' as ObjectId;
const SOLID = 'solid' as ObjectId;
const CROP = { type: 'selection', command: 'cropImageFill' } as const;

/**
 * An engine document over a board with an image-filled rectangle and a solid one.
 *
 * @returns The document and its store.
 */
function setUp() {
  const filled = {
    ...memoryShape(FILLED, 'a0'),
    width: 200,
    height: 150,
    fill: PAINT,
  } as BoardObject;
  const solid = memoryShape(SOLID, 'a1');
  const store = createDemoDocument([filled, solid]);
  let next = 0;
  const document = new EngineDocument({
    store,
    history: createHistory(store, LOCAL_USER_ORIGIN.principalId),
    origin: LOCAL_USER_ORIGIN,
    environment: {
      clock: () => 1_790_000_000_000,
      createId: () => `new-${String((next += 1))}` as ObjectId,
    },
    onChange: () => undefined,
  });
  document.attach({ enqueue: () => undefined, showOverlay: () => undefined });
  return { document, store };
}

describe('cropImageFill', () => {
  it('starts fill crop mode on the one selected image-filled shape; Enter writes its crop', () => {
    const { document, store } = setUp();
    document.selectTool.select([FILLED]);
    expect(document.runCanvasAction(CROP, 1)).toBe(true);
    const mode = document.tools.router.activeMode;
    expect(mode).toBeInstanceOf(CropMode);
    if (!(mode instanceof CropMode)) return;
    mode.onKey({ kind: 'nudge', direction: 'left', isLarge: true });
    const { crop } = mode;
    expect(crop.width).toBeLessThan(1);
    document.runCanvasAction({ type: 'selection', command: 'activate' }, 1);
    expect(document.tools.router.activeMode).not.toBeInstanceOf(CropMode);
    expect(store.get(FILLED)).toMatchObject({ fill: { ...PAINT, crop } });
  });

  it('pressed again, commits the open crop and starts afresh with its preview shown', () => {
    const { document, store } = setUp();
    document.selectTool.select([FILLED]);
    document.runCanvasAction(CROP, 1);
    const first = document.tools.router.activeMode;
    if (!(first instanceof CropMode)) throw new Error('no crop mode');
    first.onKey({ kind: 'nudge', direction: 'left', isLarge: true });
    const { crop } = first;
    document.runCanvasAction(CROP, 1);
    const second = document.tools.router.activeMode;
    expect(second).toBeInstanceOf(CropMode);
    expect(second).not.toBe(first);
    expect(store.get(FILLED)).toMatchObject({ fill: { ...PAINT, crop } });
    if (second instanceof CropMode) expect(second.crop).toEqual(crop);
    const shown = document.tools.sourceOver({ get: () => undefined }).get(FILLED);
    expect(shown).toMatchObject({ fill: { ...PAINT, crop } });
  });

  it('starts nothing for a solid fill, two objects, no selection or a viewer', () => {
    const { document } = setUp();
    for (const ids of [[SOLID], [FILLED, SOLID], []]) {
      document.selectTool.select(ids);
      expect(document.runCanvasAction(CROP, 1)).toBe(false);
      expect(document.tools.router.activeMode).not.toBeInstanceOf(CropMode);
    }
    document.setEditable(false);
    document.selectTool.select([FILLED]);
    document.runCanvasAction(CROP, 1);
    expect(document.tools.router.activeMode).not.toBeInstanceOf(CropMode);
  });
});
