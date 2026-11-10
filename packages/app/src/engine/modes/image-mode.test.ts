import { describe, expect, it, vi } from 'vitest';

import { createHistory } from '@canvas/document';
import type { AssetId, ImageObject, ObjectId, Point, PrincipalId } from '@canvas/schema';

import { NO_IMAGES_MESSAGE } from '../../assets/page-images.js';
import { TEXT_CAMERA } from '../__fixtures__/text-document.js';
import { createDemoDocument, LOCAL_USER_ORIGIN } from '../demo-document.js';
import { EngineDocument } from '../engine-document.js';
import type { ScreenPointerInput } from '../select-input-binding.js';
import { TYPING_CAPTURE_WINDOW_MS } from '../typing-undo-policy.js';

// The image tool and crop mode on the engine's document side, as the canvas drives them:
// `i` opens the picker and hands back; activating an image crops it, one setStyle on Enter,
// nothing on Escape. In Chrome: tooling/scenario/specs/tools/image.spec.ts.

const PHOTO = 'photo' as ObjectId;

/** A 400 × 300 photo at (200, 100), uncropped. */
const IMAGE: ImageObject = {
  id: PHOTO,
  type: 'image',
  parentId: null,
  x: 200,
  y: 100,
  rotation: 0,
  z: 'a0',
  locked: false,
  createdBy: 'user:local' as PrincipalId,
  createdAt: 1,
  updatedAt: 1,
  width: 400,
  height: 300,
  assetId: 'a'.repeat(64) as AssetId,
  crop: { x: 0, y: 0, width: 1, height: 1 },
  naturalSize: { width: 4000, height: 3000 },
  opacity: 1,
};

/**
 * The document side holding the photo, with a picker the test controls.
 *
 * @param options - Whether the page has a picker, and whether the photo is locked.
 * @param options.hasPicker - Whether the page can pick images; true by default.
 * @param options.isLocked - Whether the photo is locked.
 * @returns The document, the store, the history and what was recorded.
 */
function setUp(options: { hasPicker?: boolean; isLocked?: boolean } = {}) {
  const store = createDemoDocument([]);
  store.transact(LOCAL_USER_ORIGIN, (transaction) => {
    transaction.setObject({ ...IMAGE, locked: options.isLocked ?? false });
  });
  const history = createHistory(store, LOCAL_USER_ORIGIN.principalId, {
    captureTimeout: TYPING_CAPTURE_WINDOW_MS,
  });
  const picks: (Point | undefined)[] = [];
  const notices: string[] = [];
  const onToolChange = vi.fn();
  const document = new EngineDocument({
    store,
    history,
    origin: LOCAL_USER_ORIGIN,
    environment: { clock: () => 1_790_000_000_000, createId: () => 'new' as ObjectId },
    onChange: () => undefined,
    onToolChange,
    onNotice: (message) => notices.push(message),
    ...(options.hasPicker === false
      ? {}
      : {
          pickImages: (at: Point | undefined) => {
            picks.push(at);
            return Promise.resolve();
          },
        }),
  });
  document.attach({ enqueue: () => undefined, showOverlay: () => undefined });
  const send = (
    kind: 'pointerDown' | 'pointerMove' | 'pointerUp',
    x: number,
    y: number,
    timeStamp = 0,
  ) => {
    const input: ScreenPointerInput = {
      kind,
      screen: { x, y },
      isShiftPressed: false,
      isModPressed: false,
      timeStamp,
    };
    document.handlePointer(input, TEXT_CAMERA);
  };
  const doubleClick = (x: number, y: number) => {
    for (const timeStamp of [0, 100]) {
      send('pointerDown', x, y, timeStamp);
      send('pointerUp', x, y, timeStamp);
    }
  };
  const photo = () => store.get(PHOTO) as ImageObject;
  return { document, history, send, doubleClick, photo, picks, notices, onToolChange };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the image tool on the document side', () => {
  it('opens the picker for the view’s centre and hands back to select when it closes', async () => {
    const { document, picks, onToolChange } = setUp();
    document.setActiveTool('image');
    expect(picks).toEqual([undefined]);
    await settle();
    expect(onToolChange).toHaveBeenLastCalledWith('select');
  });

  it('says there are no images on a page without an assets service', async () => {
    const { document, notices, onToolChange } = setUp({ hasPicker: false });
    document.setActiveTool('image');
    await settle();
    expect(notices).toEqual([NO_IMAGES_MESSAGE]);
    expect(onToolChange).toHaveBeenLastCalledWith('select');
  });
});

describe('crop mode on the document side', () => {
  it('crops a double-clicked image with one setStyle on Enter, one undo step', () => {
    const { document, history, send, doubleClick, photo } = setUp();
    doubleClick(400, 250);
    send('pointerMove', 400, 250);
    expect(document.cursor()).toBe('move');
    // Drag the top-left handle 100 right and 75 down.
    send('pointerDown', 200, 100);
    send('pointerMove', 300, 175);
    send('pointerUp', 300, 175);
    expect(photo().crop).toEqual(IMAGE.crop);
    document.runCanvasAction({ type: 'selection', command: 'activate' }, 1);
    expect(photo()).toMatchObject({
      crop: { x: 0.25, y: 0.25, width: 0.75, height: 0.75 },
      x: 300,
      y: 175,
      width: 300,
      height: 225,
    });
    history.undo();
    expect(photo()).toMatchObject({ crop: IMAGE.crop, x: 200, width: 400 });
  });

  it('writes nothing on Escape', () => {
    const { document, send, doubleClick, photo } = setUp();
    doubleClick(400, 250);
    send('pointerDown', 600, 400);
    send('pointerMove', 500, 300);
    send('pointerUp', 500, 300);
    document.runCanvasAction({ type: 'selection', command: 'deselect' }, 1);
    expect(photo()).toEqual({ ...IMAGE, pageId: 'page-1' });
  });

  it('drops a crop under way on a downgrade, writing nothing', () => {
    const { document, send, doubleClick, photo } = setUp();
    doubleClick(400, 250);
    send('pointerDown', 200, 100);
    send('pointerMove', 300, 175);
    send('pointerUp', 300, 175);
    // Ending crop mode as usual would write the crop; a viewer's ending writes nothing.
    document.setEditable(false);
    expect(photo()).toEqual({ ...IMAGE, pageId: 'page-1' });
    expect(document.tools.router.activeTool).toBe('select');
  });

  it('enters crop mode with Enter on a selected image, and not on a locked one', () => {
    const selected = setUp();
    selected.document.panels.board.select([PHOTO]);
    selected.document.runCanvasAction({ type: 'selection', command: 'activate' }, 1);
    // Crop mode hides the selection frame and draws the crop box instead.
    expect(selected.document.tools.overlay().frame).toBeUndefined();
    expect(selected.document.tools.overlay().toolRects.length).toBeGreaterThan(0);
    const locked = setUp({ isLocked: true });
    locked.doubleClick(400, 250);
    expect(locked.document.tools.overlay().frame).toBeDefined();
  });
});
