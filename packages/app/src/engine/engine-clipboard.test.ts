// @vitest-environment jsdom
// A mount's clipboard side over a stub of the document's: the pointer it follows, the
// flavours it encodes, and duplicate. The document side: document-clipboard.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Camera } from '@canvas/engine';
import { createBoard, type AssetId, type Board, type ObjectId } from '@canvas/schema';

import { CopiedAssets, type CopiedAssetsStorage } from '../assets/copied-assets.js';
import { CopyLedger } from '../assets/copy-ledger.js';
import type { PageImages } from '../assets/page-images.js';
import { clipboardBoard } from '../clipboard/__fixtures__/clipboard-board.js';

import { COMPONENT_DRAG_TYPE } from './component-drop.js';
import type { DocumentClipboard, DocumentCut } from './document-clipboard.js';
import { EngineClipboard } from './engine-clipboard.js';

/** The camera: panned to (100, 50) at 200%, over a 400 × 200 view. */
const CAMERA: Camera = {
  x: 100,
  y: 50,
  zoom: 2,
  viewportWidthPx: 400,
  viewportHeightPx: 200,
  dpr: 1,
};

afterEach(() => {
  document.body.replaceChildren();
});

/**
 * A stub of the document's clipboard side.
 *
 * @param copied - What it copies.
 * @param cut - What it prepares for a cut.
 * @returns The stub.
 */
function stubDocument(copied: Board | undefined, cut: DocumentCut = { kind: 'empty' }) {
  return {
    copySelection: vi.fn(() => copied),
    prepareCut: vi.fn(() => cut),
    clipboardColors: vi.fn(() => ({})),
    pasteTarget: vi.fn((pointer: unknown, viewCentre: unknown) => ({
      pointer,
      viewCentre,
      createObjects: () => undefined,
    })),
    duplicateSelection: vi.fn(),
    placeInstance: vi.fn(),
    canPlace: vi.fn(() => true),
  };
}

/**
 * A mount's clipboard over a canvas in the page.
 *
 * @param stub - The document's clipboard side.
 * @returns The canvas and the clipboard.
 */
function mount(stub: ReturnType<typeof stubDocument>) {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const clipboard = new EngineClipboard(canvas, stub as unknown as DocumentClipboard, () => CAMERA);
  return { canvas, clipboard };
}

describe('EngineClipboard', () => {
  it('pastes at the pointer on the board while it is over the canvas, and at none after it leaves', () => {
    const stub = stubDocument(undefined);
    const { canvas, clipboard } = mount(stub);
    expect(clipboard.pasteTarget().pointer).toBeUndefined();
    canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 40, clientY: 20 }));
    expect(clipboard.pasteTarget()).toMatchObject({
      pointer: { x: 120, y: 60 },
      viewCentre: { x: 200, y: 100 },
    });
    canvas.dispatchEvent(new PointerEvent('pointerleave'));
    expect(clipboard.pasteTarget().pointer).toBeUndefined();
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, clientY: 0 }));
    expect(clipboard.pasteTarget().pointer).toEqual({ x: 100, y: 50 });
    clipboard.destroy();
    canvas.dispatchEvent(new PointerEvent('pointerleave'));
    expect(clipboard.pasteTarget().pointer).toEqual({ x: 100, y: 50 });
  });

  it('encodes the copy and a ready cut as clipboard flavours, and passes refusals on', () => {
    const board = createBoard([]);
    const remove = vi.fn();
    const ready = mount(stubDocument(board, { kind: 'ready', copied: board, remove })).clipboard;
    expect([...(ready.copySelection()?.keys() ?? [])]).toEqual([
      'application/x-canvas-objects+json',
      'text/plain',
      'text/html',
    ]);
    const cut = ready.prepareCut();
    expect(cut.kind === 'ready' && cut.flavours.get('text/plain')).toBe('');
    if (cut.kind === 'ready') cut.remove();
    expect(remove).toHaveBeenCalledOnce();
    const refused = mount(
      stubDocument(undefined, { kind: 'refused', message: 'locked' }),
    ).clipboard;
    expect(refused.copySelection()).toBeUndefined();
    expect(refused.prepareCut()).toEqual({ kind: 'refused', message: 'locked' });
  });

  it('duplicates on mod+d and leaves every other action to the document', () => {
    const stub = stubDocument(undefined);
    const { clipboard } = mount(stub);
    expect(clipboard.runCanvasAction({ type: 'selection', command: 'duplicate' })).toBe(true);
    expect(clipboard.runCanvasAction({ type: 'selection', command: 'copy' })).toBe(false);
    expect(clipboard.runCanvasAction({ type: 'history', command: 'undo' })).toBe(false);
    expect(stub.duplicateSelection).toHaveBeenCalledOnce();
  });

  it('places a main at the view’s centre, at a point, or where a row is dropped', () => {
    const stub = stubDocument(undefined);
    const { canvas, clipboard } = mount(stub);
    const id = 'card' as ObjectId;
    expect(clipboard.runCanvasAction({ type: 'component', command: 'placeInstanceAt', id })).toBe(
      true,
    );
    expect(stub.placeInstance).toHaveBeenLastCalledWith(id, { x: 200, y: 100 });
    const at = { x: 7, y: 8 };
    clipboard.runCanvasAction({ type: 'component', command: 'placeInstanceAt', id, at });
    expect(stub.placeInstance).toHaveBeenLastCalledWith(id, at);
    expect(clipboard.runCanvasAction({ type: 'component', command: 'detach', id })).toBe(false);
    canvas.getBoundingClientRect = () => ({ left: 10, top: 20 }) as DOMRect;
    const drop = new Event('drop', { cancelable: true });
    Object.defineProperties(drop, {
      dataTransfer: {
        value: { types: [COMPONENT_DRAG_TYPE], getData: () => 'card', dropEffect: 'none' },
      },
      clientX: { value: 30 },
      clientY: { value: 40 },
    });
    canvas.dispatchEvent(drop);
    // (20, 20) on the canvas at 200% from (100, 50).
    expect(stub.placeInstance).toHaveBeenLastCalledWith(id, { x: 110, y: 60 });
    stub.canPlace.mockReturnValue(false);
    canvas.dispatchEvent(drop);
    expect(stub.placeInstance).toHaveBeenCalledTimes(3);
  });

  describe('the record of what this browser copied', () => {
    const photo = 'asset-photo' as AssetId;

    /**
     * A clipboard on a board, over a record of its own.
     *
     * @param copied - What the document copies.
     * @param boardId - The page's board, or undefined for a page that knows none.
     * @param cut - What the document prepares for a cut.
     * @returns The clipboard and the record.
     */
    function recording(copied: Board, boardId: string | undefined, cut?: DocumentCut) {
      const items = new Map<string, string>();
      const storage: CopiedAssetsStorage = {
        getItem: (key) => items.get(key) ?? null,
        setItem: (key, value) => {
          items.set(key, value);
        },
      };
      const record = new CopiedAssets({ storage: () => storage });
      const canvas = document.createElement('canvas');
      const stub = stubDocument(copied, cut);
      const clipboard = new EngineClipboard(
        canvas,
        stub as unknown as DocumentClipboard,
        () => CAMERA,
        { boardId, copies: new CopyLedger(record) } as PageImages,
      );
      return { clipboard, record };
    }

    it('records the assets of the images a copy puts on the clipboard, with the board', () => {
      const { clipboard, record } = recording(clipboardBoard(), 'board-a');
      expect(record.wasCopiedFrom([photo], 'board-a')).toBe(false);
      clipboard.copySelection();
      expect(record.wasCopiedFrom([photo], 'board-a')).toBe(true);
      expect(record.wasCopiedFrom([photo], 'board-b')).toBe(false);
    });

    it('records the assets of a cut once it is prepared', () => {
      const board = clipboardBoard();
      const cut: DocumentCut = { kind: 'ready', copied: board, remove: vi.fn() };
      const { clipboard, record } = recording(board, 'board-a', cut);
      clipboard.prepareCut();
      expect(record.wasCopiedFrom([photo], 'board-a')).toBe(true);
    });

    it('records nothing for a copy without images, or on a page that knows no board', () => {
      const { clipboard, record } = recording(createBoard([]), 'board-a');
      clipboard.copySelection();
      expect(record.wasCopiedFrom([photo], 'board-a')).toBe(false);
      const unnamed = recording(clipboardBoard(), undefined);
      unnamed.clipboard.copySelection();
      expect(unnamed.record.wasCopiedFrom([photo], '')).toBe(false);
      expect(unnamed.record.wasCopiedFrom([photo], 'board-a')).toBe(false);
    });
  });
});
