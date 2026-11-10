// The shape tool: a drag draws a shape in the tool's style, previewed as it goes, Shift
// keeping it 1:1 and Alt drawing it from its centre, its corner snapping to neighbours; a click
// makes a default one; the shape is one undo step, selected, and the select tool takes over. An
// activated shape has its label edited with the text editor.
import { describe, expect, it } from 'vitest';

import type { CommandError } from '@canvas/document';
import type { ObjectId, ShapeObject } from '@canvas/schema';

import type { ToolPointerInput } from '../modes/tool-mode.js';
import { indexOf, mapSource, rect } from '../select/__fixtures__/select-board.js';
import { createTextModeContext } from '../text/__fixtures__/text-mode-context.js';

import { DEFAULT_SHAPE_STYLE } from './new-shape-object.js';
import { DEFAULT_SHAPE_SIZE } from './shape-drag.js';
import { ShapeMode, type ShapeModeContext } from './shape-mode.js';

/** The modifiers a pointer input may carry. */
interface Modifiers {
  readonly isShiftPressed?: boolean;
  readonly isSnapSuspended?: boolean;
}

/**
 * A primary-button input at a world point, the camera at the origin at 100%.
 *
 * @param kind - Down, move or up.
 * @param x - World x, and CSS px.
 * @param y - World y.
 * @param modifiers - Shift and Alt.
 * @returns The input.
 */
function at(
  kind: 'pointerDown' | 'pointerMove' | 'pointerUp',
  x: number,
  y: number,
  modifiers: Modifiers = {},
) {
  return {
    kind,
    screen: { x, y },
    world: { x, y },
    isShiftPressed: modifiers.isShiftPressed ?? false,
    isModPressed: false,
    isSnapSuspended: modifiers.isSnapSuspended ?? false,
    zoom: 1,
    snapping: { isEnabled: true, isGridVisible: false },
  } satisfies ToolPointerInput;
}

/**
 * A primary-button input with no snapping preferences, as a caller without them sends.
 *
 * @param kind - Down, move or up.
 * @param x - World x, and CSS px.
 * @param y - World y.
 * @returns The input.
 */
function withoutSnapping(kind: 'pointerDown' | 'pointerMove' | 'pointerUp', x: number, y: number) {
  return {
    kind,
    screen: { x, y },
    world: { x, y },
    isShiftPressed: false,
    isModPressed: false,
    zoom: 1,
  } satisfies ToolPointerInput;
}

/**
 * Drags with a mode from one point to another.
 *
 * @param mode - The mode.
 * @param from - The press.
 * @param to - The release.
 * @param modifiers - Shift and Alt, held throughout.
 * @returns The release's step.
 */
function drag(
  mode: ShapeMode,
  from: readonly [number, number],
  to: readonly [number, number],
  modifiers: Modifiers = {},
) {
  mode.onPointer(at('pointerDown', ...from, modifiers));
  mode.onPointer(at('pointerMove', ...to, modifiers));
  return mode.onPointer(at('pointerUp', ...to, modifiers));
}

/**
 * A shape mode creating shapes over a store, with refusals recorded.
 *
 * @param extra - Context fields to add.
 * @returns The fixture, the mode and the refusals.
 */
function creating(extra: Partial<ShapeModeContext> = {}) {
  const fixture = createTextModeContext([rect('n', null, { x: 0, y: 0, width: 100, height: 100 })]);
  const refused: (readonly CommandError[])[] = [];
  const context: ShapeModeContext = {
    ...fixture.context,
    onCommandRefused: (errors) => refused.push(errors),
    ...extra,
  };
  const mode = new ShapeMode(context, { kind: 'create' });
  const read = (id: string): ShapeObject | undefined =>
    fixture.store.get(id as ObjectId) as ShapeObject | undefined;
  return { ...fixture, mode, refused, read };
}

describe('ShapeMode creating shapes', () => {
  it('reads the size of the shape being drawn below it, in whole units, until the release', () => {
    const { mode } = creating();
    mode.onPointer(withoutSnapping('pointerDown', 300, 300));
    expect(mode.overlay().labels).toBeUndefined();
    mode.onPointer(withoutSnapping('pointerMove', 468.4, 400.2));
    expect(mode.overlay().labels).toEqual([
      { kind: 'extent', text: '168 × 100', at: { x: 384.2, y: 400.2 } },
    ]);
    mode.onPointer(withoutSnapping('pointerUp', 468.4, 400.2));
    expect(mode.overlay().labels).toBeUndefined();
  });

  it('asks for a crosshair and writes nothing on a press', () => {
    const { mode, store } = creating();
    expect(mode.id).toBe('shape');
    expect(mode.cursor).toBe('crosshair');
    expect(mode.session).toBeUndefined();
    mode.onPointer(at('pointerDown', 200, 200));
    expect(store.read().objects.size).toBe(1);
  });

  it('previews a drag as the shape, then creates it in one step, selected, and is done', () => {
    const { mode, read, record } = creating();
    mode.onPointer(at('pointerDown', 200, 200));
    mode.onPointer(at('pointerMove', 260, 240));
    expect(record.previews.get('new-1' as ObjectId)).toMatchObject({
      type: 'shape',
      x: 200,
      y: 200,
      width: 60,
      height: 40,
      z: '~',
    });
    expect(mode.onPointer(at('pointerUp', 300, 260))).toEqual({ isDone: true });
    expect(read('new-1')).toMatchObject({
      type: 'shape',
      kind: DEFAULT_SHAPE_STYLE.kind,
      x: 200,
      y: 200,
      width: 100,
      height: 60,
      label: null,
    });
    expect(record.capture).toEqual(['command']);
    expect(record.selected).toEqual([['new-1']]);
    expect(record.previews.get('new-1' as ObjectId)).toBeUndefined();
  });

  it('makes a default-size shape centred on a click', () => {
    const { mode, read } = creating();
    mode.onPointer(at('pointerDown', 300, 300));
    mode.onPointer(at('pointerMove', 301, 301));
    expect(mode.onPointer(at('pointerUp', 301, 301))).toEqual({ isDone: true });
    const half = DEFAULT_SHAPE_SIZE / 2;
    expect(read('new-1')).toMatchObject({ x: 300 - half, y: 300 - half, width: 100, height: 100 });
  });

  it('keeps 1:1 with Shift and draws from the centre with Alt', () => {
    const square = creating();
    drag(square.mode, [200, 200], [260, 220], { isShiftPressed: true });
    expect(square.read('new-1')).toMatchObject({ width: 60, height: 60 });
    const centred = creating();
    drag(centred.mode, [300, 300], [330, 310], { isSnapSuspended: true });
    expect(centred.read('new-1')).toMatchObject({ x: 270, y: 290, width: 60, height: 20 });
  });

  it("makes the tool's kind in its style: the last kind picked", () => {
    const style = { ...DEFAULT_SHAPE_STYLE, kind: 'star' as const, sides: 6, fill: null };
    const { mode, read } = creating({ newShapeStyle: () => style });
    drag(mode, [200, 200], [300, 300]);
    expect(read('new-1')).toMatchObject({ kind: 'star', sides: 6, fill: null });
  });

  it("snaps the drag's corners to a neighbour's edges, showing guides, but not with Shift", () => {
    const neighbour = rect('n', null, { x: 0, y: 0, width: 100, height: 100 });
    const snap = { index: indexOf([neighbour]), source: mapSource([neighbour]) };
    const snapped = creating({ snap });
    snapped.mode.onPointer(at('pointerDown', 104, 150));
    snapped.mode.onPointer(at('pointerMove', 180, 97));
    expect(snapped.mode.overlay().guides?.length).toBeGreaterThan(0);
    snapped.mode.onPointer(at('pointerUp', 180, 97));
    expect(snapped.read('new-1')).toMatchObject({ x: 100, y: 100, width: 80, height: 50 });
    const squared = creating({ snap });
    drag(squared.mode, [104, 150], [180, 97], { isShiftPressed: true });
    expect(squared.read('new-1')).toMatchObject({ x: 104, width: 76, height: 76 });
  });

  it('shows no guides before a drag, and snaps nothing without preferences; looks on screen', () => {
    const neighbour = rect('n', null, { x: 0, y: 0, width: 100, height: 100 });
    const snap = { index: indexOf([neighbour]), source: mapSource([neighbour]) };
    const { mode, read } = creating({ snap });
    expect(mode.overlay()).toEqual({});
    mode.onPointer(withoutSnapping('pointerDown', 104, 150));
    mode.onPointer(withoutSnapping('pointerMove', 180, 97));
    mode.onPointer(withoutSnapping('pointerUp', 180, 97));
    expect(read('new-1')).toMatchObject({ x: 104, y: 97, width: 76, height: 53 });
    // With the camera, candidates are looked for on screen only: the neighbour is off it here.
    const camera = {
      x: 1000,
      y: 1000,
      zoom: 1,
      viewportWidthPx: 100,
      viewportHeightPx: 100,
      dpr: 1,
    };
    const offScreen = creating({ snap });
    offScreen.mode.onPointer({ ...at('pointerDown', 1004, 1050), camera });
    offScreen.mode.onPointer({ ...at('pointerMove', 1080, 1097), camera });
    offScreen.mode.onPointer({ ...at('pointerUp', 1080, 1097), camera });
    expect(offScreen.read('new-1')).toMatchObject({ x: 1004, y: 1050 });
  });

  it('drops a drag on Escape or a lost pointer, writing nothing, and leaves on Escape at rest', () => {
    const { mode, store, record } = creating();
    mode.onPointer(at('pointerDown', 200, 200));
    mode.onPointer(at('pointerMove', 260, 240));
    expect(mode.onKey({ kind: 'escape' })).toBe(true);
    expect(record.previews.get('new-1' as ObjectId)).toBeUndefined();
    expect(mode.onPointer(at('pointerUp', 260, 240))).toEqual({ isDone: false });
    mode.onPointer(at('pointerDown', 200, 200));
    mode.onPointer(at('pointerMove', 260, 240));
    mode.onPointer({ kind: 'pointerCancel' });
    expect(store.read().objects.size).toBe(1);
    expect(record.exitRequests).toBe(0);
    expect(mode.onKey({ kind: 'escape' })).toBe(true);
    expect(record.exitRequests).toBe(1);
    expect(mode.onKey({ kind: 'delete' })).toBe(false);
  });

  it('reports a refused creation and stays, with nothing written', () => {
    const { mode, refused, store } = creating({
      environment: { clock: () => 1, createId: () => 'n' as ObjectId },
    });
    expect(drag(mode, [200, 200], [300, 300])).toEqual({ isDone: false });
    expect(refused).toHaveLength(1);
    expect(store.read().objects.size).toBe(1);
  });

  it('ignores moves and releases without a press, and a secondary click', () => {
    const { mode, store } = creating();
    expect(mode.onPointer(at('pointerMove', 10, 10))).toEqual({ isDone: false });
    expect(mode.onPointer(at('pointerUp', 10, 10))).toEqual({ isDone: false });
    expect(mode.onPointer({ ...at('pointerDown', 10, 10), kind: 'contextPress' })).toEqual({
      isDone: false,
    });
    mode.onZoom(2);
    mode.exit();
    expect(store.read().objects.size).toBe(1);
  });
});

describe('ShapeMode editing a label', () => {
  it("edits an activated shape's label with the text editor, then hands a press outside on", () => {
    const shape = rect('s', null, { x: 0, y: 0, width: 200, height: 100 });
    const { context, store } = createTextModeContext([shape]);
    const mode = new ShapeMode(context, { kind: 'edit', id: shape.id, world: { x: 100, y: 50 } });
    expect(mode.session?.id).toBe('s');
    expect(mode.cursor).toBe('text');
    mode.session?.type('Hi');
    expect(store.get(shape.id)).toMatchObject({ label: { text: 'Hi' } });
    expect(mode.overlay().toolRects?.length).toBeGreaterThan(0);
    expect(mode.onKey({ kind: 'enter' })).toBe(true);
    mode.onZoom(2);
    expect(mode.onPointer(at('pointerDown', 400, 400))).toEqual({
      isDone: true,
      isPassedOn: true,
    });
    mode.exit();
  });

  it('edits nothing for an object that is gone, and creates instead', () => {
    const { context } = createTextModeContext();
    const mode = new ShapeMode(context, { kind: 'edit', id: 'gone' as ObjectId });
    expect(mode.session).toBeUndefined();
    expect(mode.cursor).toBe('crosshair');
  });
});

describe('ShapeMode.abandon', () => {
  it('drops a creation drag and a label edit writing nothing', () => {
    const { mode, store } = creating();
    mode.onPointer(at('pointerDown', 200, 200));
    mode.onPointer(at('pointerMove', 260, 240));
    mode.abandon();
    expect(store.read().objects.size).toBe(1);
    const shape = rect('s', null, { x: 0, y: 0, width: 200, height: 100 });
    const labelled = createTextModeContext([shape]);
    const editing = new ShapeMode(labelled.context, {
      kind: 'edit',
      id: shape.id,
      world: { x: 100, y: 50 },
    });
    editing.session?.type('Hi');
    const before = labelled.store.read();
    editing.abandon();
    expect(labelled.store.read()).toBe(before);
  });
});
