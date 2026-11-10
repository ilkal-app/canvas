import { describe, expect, it } from 'vitest';

import type { LineObject, ObjectId, Point } from '@canvas/schema';

import type { ToolPointerInput } from '../modes/tool-mode.js';
import { SELECTION_COLOR } from '../select/overlay-rects.js';
import type { SelectPointer } from '../select/select-input.js';

import { lineToolContext, PLAIN_STYLE } from './__fixtures__/line-tool-context.js';
import { LineMode } from './line-mode.js';

const SNAPPING = { isEnabled: true, isGridVisible: false };

/** Shift and the snap modifier, held through an input. */
type Modifiers = Partial<Pick<SelectPointer, 'isShiftPressed' | 'isSnapSuspended'>>;

/**
 * A pointer input at zoom 1, where screen and world points coincide.
 *
 * @param kind - The input's kind.
 * @param world - The point.
 * @param modifiers - Shift and the snap modifier.
 * @returns The input.
 */
function input(
  kind: 'pointerDown' | 'pointerMove' | 'pointerUp',
  world: Point,
  modifiers: Modifiers = {},
): Exclude<ToolPointerInput, { readonly kind: 'hold' | 'pointerCancel' }> {
  return {
    kind,
    screen: world,
    world,
    isShiftPressed: false,
    isModPressed: false,
    zoom: 1,
    snapping: SNAPPING,
    ...modifiers,
  };
}

/**
 * Drags from one point to another and releases.
 *
 * @param mode - The line tool.
 * @param from - The press.
 * @param to - The release.
 * @param modifiers - Held through the drag.
 * @returns The release's step.
 */
function drag(mode: LineMode, from: Point, to: Point, modifiers: Modifiers = {}) {
  mode.onPointer(input('pointerDown', from, modifiers));
  mode.onPointer(input('pointerMove', to, modifiers));
  return mode.onPointer(input('pointerUp', to, modifiers));
}

/**
 * The line a store holds under an id.
 *
 * @param store - The store.
 * @param store.get - Reads an object.
 * @param id - The id.
 * @returns The line, if it is one.
 */
function lineIn(store: { get(id: ObjectId): unknown }, id: string): LineObject | undefined {
  const object = store.get(id as ObjectId) as LineObject | undefined;
  return object?.type === 'line' ? object : undefined;
}

describe('LineMode', () => {
  it('draws a line by drag as one createObject, selects it and hands back to select', () => {
    const { store, context, record } = lineToolContext();
    const mode = new LineMode(context);
    mode.onPointer(input('pointerDown', { x: 300, y: 400 }));
    mode.onPointer(input('pointerMove', { x: 360, y: 430 }));
    expect(record.previews.get('new-1' as ObjectId)).toMatchObject({ type: 'line', x: 300 });
    expect(lineIn(store, 'new-1')).toBeUndefined();
    const step = mode.onPointer(input('pointerUp', { x: 400, y: 450 }));
    expect(step.isDone).toBe(true);
    expect(lineIn(store, 'new-1')).toMatchObject({
      x: 300,
      y: 400,
      rotation: 0,
      parentId: null,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 50 },
      ],
      ...PLAIN_STYLE,
    });
    expect(record.commands).toBe(1);
    expect(record.selected).toEqual([['new-1']]);
    expect(record.previews.get('new-1' as ObjectId)).toBeUndefined();
  });

  it('draws in the tool’s style: the arrow sub-tool’s end cap', () => {
    const { store, context } = lineToolContext({ ...PLAIN_STYLE, endCap: 'arrow' });
    drag(new LineMode(context), { x: 300, y: 400 }, { x: 400, y: 400 });
    expect(lineIn(store, 'new-1')?.endCap).toBe('arrow');
  });

  it('snaps both ends onto object anchors', () => {
    const { store, context } = lineToolContext();
    // rect-a's right edge midpoint is (100, 25); its centre (50, 25).
    drag(new LineMode(context), { x: 104, y: 28 }, { x: 53, y: 22 });
    const line = lineIn(store, 'new-1');
    expect({ x: line?.x, y: line?.y }).toEqual({ x: 100, y: 25 });
    expect(line?.points[1]).toEqual({ x: -50, y: 0 });
  });

  it('constrains the end to 45° with Shift', () => {
    const { store, context } = lineToolContext();
    drag(new LineMode(context), { x: 300, y: 400 }, { x: 400, y: 410 }, { isShiftPressed: true });
    const end = lineIn(store, 'new-1')?.points[1];
    expect(end?.y).toBeCloseTo(0, 9);
    expect(end?.x).toBeCloseTo(Math.hypot(100, 10), 9);
  });

  it('does not snap with the snap modifier held', () => {
    const { store, context } = lineToolContext();
    drag(new LineMode(context), { x: 104, y: 28 }, { x: 204, y: 128 }, { isSnapSuspended: true });
    expect(lineIn(store, 'new-1')).toMatchObject({ x: 104, y: 28 });
  });

  it('draws nothing for a click, and stays the active tool', () => {
    const { store, context, record } = lineToolContext();
    const step = drag(new LineMode(context), { x: 300, y: 400 }, { x: 301, y: 401 });
    expect(step.isDone).toBe(false);
    expect(lineIn(store, 'new-1')).toBeUndefined();
    expect(record.commands).toBe(0);
  });

  it('draws nothing for a drag whose two ends snap onto one anchor, and stays the tool', () => {
    const { store, context, record } = lineToolContext();
    // Both ends land on rect-a's right edge midpoint, (100, 25), though the pointer travelled.
    const step = drag(new LineMode(context), { x: 104, y: 28 }, { x: 97, y: 21 });
    expect(step.isDone).toBe(false);
    expect(lineIn(store, 'new-1')).toBeUndefined();
    expect(record.commands).toBe(0);
    expect(record.previews.get('new-1' as ObjectId)).toBeUndefined();
  });

  it('drops the line without writing when the drag is cancelled (a second finger lands)', () => {
    const { store, context, record } = lineToolContext();
    const mode = new LineMode(context);
    const before = store.encodeState();
    mode.onPointer(input('pointerDown', { x: 300, y: 400 }));
    mode.onPointer(input('pointerMove', { x: 380, y: 420 }));
    mode.onPointer({ kind: 'pointerCancel' });
    mode.onPointer(input('pointerUp', { x: 380, y: 420 }));
    expect(store.encodeState()).toEqual(before);
    expect(record.previews.get('new-1' as ObjectId)).toBeUndefined();
  });

  it('drops the drag on Escape, and leaves the tool on Escape with no drag', () => {
    const { store, context, record } = lineToolContext();
    const mode = new LineMode(context);
    mode.onPointer(input('pointerDown', { x: 300, y: 400 }));
    mode.onPointer(input('pointerMove', { x: 380, y: 420 }));
    expect(mode.onKey({ kind: 'escape' })).toBe(true);
    expect(record.previews.get('new-1' as ObjectId)).toBeUndefined();
    expect(record.exitRequests).toBe(0);
    expect(mode.onKey({ kind: 'escape' })).toBe(true);
    expect(record.exitRequests).toBe(1);
    expect(mode.onKey({ kind: 'delete' })).toBe(false);
    expect(lineIn(store, 'new-1')).toBeUndefined();
  });

  it('marks the anchor a hover or a drag end would land on', () => {
    const { context } = lineToolContext();
    const mode = new LineMode(context);
    mode.onPointer(input('pointerMove', { x: 104, y: 28 }));
    expect(mode.overlay().toolRects).toEqual([
      { box: { x: 97, y: 22, width: 6, height: 6, rotation: 0 }, color: SELECTION_COLOR },
    ]);
    mode.onPointer(input('pointerMove', { x: 300, y: 400 }));
    expect(mode.overlay().toolRects).toEqual([]);
  });

  it('asks for a crosshair and removes its preview when the tool is left mid-drag', () => {
    const { context, record } = lineToolContext();
    const mode = new LineMode(context);
    expect(mode.cursor).toBe('crosshair');
    mode.onPointer(input('pointerDown', { x: 300, y: 400 }));
    mode.onPointer(input('pointerMove', { x: 380, y: 420 }));
    mode.exit();
    expect(record.previews.get('new-1' as ObjectId)).toBeUndefined();
  });

  it('ignores a secondary click and a held finger', () => {
    const { context, record } = lineToolContext();
    const mode = new LineMode(context);
    const at = input('pointerDown', { x: 300, y: 400 });
    expect(mode.onPointer({ ...at, kind: 'contextPress' }).isDone).toBe(false);
    expect(
      mode.onPointer({ kind: 'hold', timeStamp: 0, screen: { x: 300, y: 400 }, zoom: 1 }).isDone,
    ).toBe(false);
    expect(record.previews.size).toBe(0);
  });

  it('shows the guides an end snapped to while the camera gives it the view', () => {
    const { context } = lineToolContext();
    const mode = new LineMode(context);
    const camera = {
      x: -500,
      y: -500,
      zoom: 1,
      viewportWidthPx: 2000,
      viewportHeightPx: 2000,
      dpr: 1,
    };
    mode.onPointer({ ...input('pointerDown', { x: 300, y: 400 }), camera });
    // 3 below rect-a's bottom edge (y 50), far from its anchors.
    mode.onPointer({ ...input('pointerMove', { x: 20, y: 53 }), camera });
    expect(mode.overlay().guides?.length).toBeGreaterThan(0);
  });

  it('redraws its markers for a new zoom only when it shows some', () => {
    const { context } = lineToolContext();
    let changes = 0;
    const mode = new LineMode({ ...context, onChange: () => (changes += 1) });
    mode.onZoom(2);
    expect(changes).toBe(0);
    mode.onPointer(input('pointerMove', { x: 104, y: 28 }));
    mode.onZoom(2);
    mode.onZoom(2);
    expect(changes).toBe(1);
  });

  it('reports a refused creation and writes without an undo capture when it has none', () => {
    const { store, context, record } = lineToolContext();
    // An id already on the board: createObject refuses it.
    const taken = new LineMode({
      ...context,
      environment: { ...context.environment, createId: () => 'rect-a' as ObjectId },
    });
    drag(taken, { x: 300, y: 400 }, { x: 400, y: 450 });
    expect(record.refusals.map((errors) => errors.map(({ code }) => code))).toEqual([
      ['duplicate-id'],
    ]);
    const { capture: unused, ...uncaptured } = context;
    drag(new LineMode(uncaptured), { x: 300, y: 400 }, { x: 400, y: 450 });
    expect(lineIn(store, 'new-1')).toBeDefined();
    expect(unused).toBeDefined();
  });

  it('shows nothing before the pointer has moved', () => {
    const { context } = lineToolContext();
    expect(new LineMode(context).overlay()).toEqual({ toolRects: [] });
  });
});
