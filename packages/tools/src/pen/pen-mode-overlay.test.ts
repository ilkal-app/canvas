// What the pen and vector edit show and the inputs they leave alone: the pen's overlay
// while hovering and dragging (the next segment's preview, the pending handle, snap guides), the
// zoom, snapping through the context against the camera's view, inputs that are not theirs, a
// path deleted or locked under them, and a release the document refuses.
import { describe, expect, it, vi } from 'vitest';

import type { ToolPointerInput } from '../modes/tool-mode.js';

import {
  click,
  createPenModeContext,
  onlyPath,
  pointer,
  testPath,
} from './__fixtures__/pen-mode-context.js';
import type { PenModeContext } from './pen-context.js';
import { createPenMode, createVectorEditMode } from './vector-modes.js';

const CAMERA = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };

/**
 * A pointer input without the snap modifier's field, as a caller that omits it sends.
 *
 * @param kind - The kind.
 * @param x - Where, x.
 * @param y - Where, y.
 * @returns The input.
 */
function bare(kind: 'pointerDown' | 'pointerMove' | 'pointerUp', x: number, y: number) {
  const { isSnapSuspended: wasSuspended, ...input } = pointer(kind, {
    x,
    y,
  }) as ToolPointerInput & {
    isSnapSuspended?: boolean;
  };
  expect(wasSuspended).toBe(false);
  return input;
}

describe('the pen’s overlay and zoom', () => {
  it('previews the next segment on hover, the pending handle while dragging, at the zoom', () => {
    const { context } = createPenModeContext();
    const onChange = vi.fn();
    const mode = createPenMode({ ...context, onChange }, { kind: 'create' });
    mode.onPointer(pointer('pointerMove', { x: 10, y: 10 }));
    expect(onChange).not.toHaveBeenCalled();
    click(mode, { x: 100, y: 100 });
    mode.onPointer(pointer('pointerMove', { x: 200, y: 108 }, { isShift: true }));
    const hovering = mode.overlay();
    expect(hovering).toMatchObject({ frame: undefined, outlines: [], canResize: false });
    // The vertex square (outer, solid when on the chain) and one line piece of the preview.
    expect(hovering.toolRects?.length).toBeGreaterThan(1);
    mode.onPointer(bare('pointerDown', 200, 100));
    mode.onPointer(bare('pointerMove', 240, 100));
    const dragging = mode.overlay().toolRects ?? [];
    expect(dragging.some(({ box }) => box.width === 40 && box.height === 1)).toBe(true);
    mode.onPointer(bare('pointerUp', 240, 100));
    mode.onZoom(2);
    mode.onZoom(2);
    expect(onChange).toHaveBeenCalled();
    // Vertex squares are 8 CSS px: 4 world units at 200%.
    expect(mode.overlay().toolRects?.some(({ box }) => box.width === 4)).toBe(true);
  });

  it('snaps new points through the context against the camera’s view, and shows the guides', () => {
    const { store, context } = createPenModeContext();
    const snapPoint = vi.fn<NonNullable<PenModeContext['snapPoint']>>((world) => ({
      point: { x: Math.round(world.x / 50) * 50, y: world.y },
      guides: [{ axis: 'x', position: 0, from: 0, to: 1 } as never],
    }));
    const mode = createPenMode({ ...context, snapPoint }, { kind: 'create' });
    const settings = { isEnabled: true, isGridVisible: false };
    const press = (x: number) => {
      mode.onPointer({
        ...pointer('pointerDown', { x, y: 100 }),
        camera: CAMERA,
        snapping: settings,
      });
      expect(mode.overlay().guides).toHaveLength(1);
      mode.onPointer(pointer('pointerUp', { x, y: 100 }));
    };
    press(98);
    press(207);
    expect(snapPoint.mock.calls[0]?.[1]).toMatchObject({ viewport: { minX: 0, maxX: 800 } });
    expect(onlyPath(store).vertices.map(({ x }) => x)).toEqual([0, 100]);
  });

  it('leaves the context menu, a held finger, select all and nudges to others', () => {
    const { context } = createPenModeContext([testPath()]);
    for (const mode of [
      createPenMode(context, { kind: 'create' }),
      createVectorEditMode(context, testPath().id),
    ]) {
      expect(
        mode.onPointer({ ...pointer('pointerDown', { x: 0, y: 0 }), kind: 'contextPress' }),
      ).toMatchObject({ isDone: false });
      expect(
        mode.onPointer({ kind: 'hold', timeStamp: 1, screen: { x: 0, y: 0 }, zoom: 1 }),
      ).toMatchObject({ isDone: false });
      expect(mode.onKey({ kind: 'selectAll' })).toBe(false);
      expect(mode.onKey({ kind: 'nudge', direction: 'up', isLarge: false })).toBe(false);
    }
  });
});

describe('the pen under a collaborator’s changes', () => {
  it('starts a new path when its path was deleted, and resets the chain when a release is refused', () => {
    const { store, context } = createPenModeContext();
    const onCommandRefused = vi.fn();
    const mode = createPenMode({ ...context, onCommandRefused }, { kind: 'create' });
    click(mode, { x: 100, y: 100 });
    click(mode, { x: 200, y: 100 });
    const first = onlyPath(store);
    store.transact(context.origin, (transaction) => transaction.deleteObject(first.id));
    click(mode, { x: 300, y: 300 });
    click(mode, { x: 350, y: 300 });
    const second = onlyPath(store);
    expect(second.id).not.toBe(first.id);
    // A collaborator removes the chain's vertex between press and release.
    mode.onPointer(pointer('pointerDown', { x: 400, y: 300 }));
    store.transact(context.origin, (transaction) => {
      transaction.patchObject(second.id, { vertices: [], segments: [] });
    });
    mode.onPointer(pointer('pointerUp', { x: 400, y: 300 }));
    expect(onCommandRefused).toHaveBeenCalledOnce();
    expect(mode.currentChain.vertexId).toBeUndefined();
  });

  it('ignores a move with nothing to shape, and Backspace with no chain', () => {
    const { store, context } = createPenModeContext([testPath()]);
    const mode = createPenMode(context, { kind: 'edit', id: testPath().id });
    const before = store.encodeState();
    // A press on a segment inserts a vertex on release; moving it shapes nothing.
    mode.onPointer(pointer('pointerDown', { x: 150, y: 100 }));
    mode.onPointer(pointer('pointerMove', { x: 180, y: 140 }));
    mode.onKey({ kind: 'delete' });
    expect(store.encodeState()).toEqual(before);
  });

  it.each([
    { what: 'a write', clicks: 3 },
    { what: 'the delete of a path whose last segment Backspace takes', clicks: 2 },
  ])('ends when Backspace meets a path locked meanwhile: $what', ({ clicks }) => {
    const { store, context, record } = createPenModeContext();
    const mode = createPenMode(context, { kind: 'create' });
    for (let index = 0; index < clicks; index += 1) click(mode, { x: 100 * (index + 1), y: 100 });
    store.transact(context.origin, (transaction) => {
      transaction.patchObject(onlyPath(store).id, { locked: true });
    });
    mode.onKey({ kind: 'delete' });
    expect(record.notices).toHaveLength(1);
    expect(record.exitRequests).toBe(1);
    expect(onlyPath(store).vertices).toHaveLength(clicks);
  });
});

describe('vector edit’s overlay, zoom and exit', () => {
  it('shows the selected vertex’s handles at the zoom, and prunes and selects on exit', () => {
    const { store, context, record } = createPenModeContext([testPath()]);
    const onChange = vi.fn();
    const mode = createVectorEditMode({ ...context, onChange }, testPath().id);
    click(mode, { x: 200, y: 100 });
    expect(mode.overlay()).toMatchObject({ frame: undefined, canResize: false });
    // Two segment lines; two handles: a line, an outer and an inner diamond each; three
    // vertices, two hollow.
    expect(mode.overlay().toolRects).toHaveLength(2 + 11);
    mode.onZoom(4);
    mode.onZoom(4);
    expect(onChange).toHaveBeenCalled();
    mode.exit();
    mode.exit();
    expect(record.selected.at(-1)).toEqual(['path-1']);
    expect(onlyPath(store).vertices).toHaveLength(3);
  });

  it('ends on a press once the path is gone, and deletes nothing then', () => {
    const { store, context } = createPenModeContext([testPath()]);
    const mode = createVectorEditMode(context, testPath().id);
    click(mode, { x: 200, y: 100 });
    store.transact(context.origin, (transaction) => transaction.deleteObject(testPath().id));
    mode.onKey({ kind: 'delete' });
    expect(mode.onPointer(pointer('pointerDown', { x: 200, y: 100 }))).toEqual({ isDone: true });
  });

  it('drags a handle with a bare input, and ends when a drag meets a path locked meanwhile', () => {
    const { store, context, record } = createPenModeContext([testPath()]);
    const mode = createVectorEditMode(context, testPath().id);
    click(mode, { x: 200, y: 100 });
    mode.onPointer(bare('pointerDown', 230, 100));
    mode.onPointer(bare('pointerMove', 230, 140));
    store.transact(context.origin, (transaction) => {
      transaction.patchObject(testPath().id, { locked: true });
    });
    mode.onPointer(bare('pointerUp', 230, 140));
    expect(record.exitRequests).toBe(1);
    expect(onlyPath(store).segments[1]?.ha).toEqual({ x: 30, y: 0 });
  });
});

describe('the modes at rest', () => {
  it('shows nothing of a pen with no path, ignores a stray release, and ends once', () => {
    const { store, context, record } = createPenModeContext();
    const pen = createPenMode(context, { kind: 'create' });
    expect(pen.overlay().toolRects).toEqual([]);
    pen.onPointer(pointer('pointerUp', { x: 5, y: 5 }));
    click(pen, { x: 100, y: 100 });
    click(pen, { x: 200, y: 100 });
    pen.exit();
    pen.exit();
    expect(record.selected.at(-1)).toEqual([onlyPath(store).id]);
  });

  it('shows vector edit’s drag as it goes, and ignores a move with no press', () => {
    const { context } = createPenModeContext([testPath()]);
    const mode = createVectorEditMode(context, testPath().id);
    mode.onPointer(pointer('pointerMove', { x: 300, y: 300 }));
    mode.onPointer(pointer('pointerDown', { x: 300, y: 100 }));
    mode.onPointer(pointer('pointerMove', { x: 300, y: 150 }));
    const squares = (mode.overlay().toolRects ?? []).filter(({ box }) => box.width === 8);
    expect(squares.some(({ box }) => box.y === 146)).toBe(true);
  });
});
