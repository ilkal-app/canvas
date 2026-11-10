import { describe, expect, it } from 'vitest';

import {
  deleteObjectsCommand,
  moveObjectsCommand,
  runCommand,
  setLinePointsCommand,
  setLockedCommand,
} from '@canvas/document';
import type { LineObject, ObjectId, Point } from '@canvas/schema';

import type { ToolPointerInput } from '../modes/tool-mode.js';
import { id } from '../select/__fixtures__/select-board.js';
import { ADA, ENVIRONMENT, storeSource } from '../select/__fixtures__/select-store.js';

import { lineToolContext } from './__fixtures__/line-tool-context.js';
import { lineEndsOf, LineEndpoints } from './line-endpoints.js';

const SNAPPING = { isEnabled: true, isGridVisible: false };
const LINE = id('line-l');

/**
 * Endpoint editing over the select board, with a selection.
 *
 * @param selection - The selected ids; line-l alone by default. line-l runs from (0, 500) to
 *   (100, 550).
 * @returns The editor, the store and what the context recorded.
 */
function editing(selection: readonly ObjectId[] = [LINE]) {
  const { store, context, record } = lineToolContext();
  const endpoints = new LineEndpoints({
    ...context,
    source: storeSource(store),
    selection: () => selection,
  });
  return { endpoints, store, record };
}

/**
 * A pointer input at zoom 1.
 *
 * @param kind - The input's kind.
 * @param world - The point.
 * @param isShiftPressed - Whether Shift is held.
 * @returns The input.
 */
function input(
  kind: 'pointerDown' | 'pointerMove' | 'pointerUp',
  world: Point,
  isShiftPressed = false,
): ToolPointerInput & { readonly kind: typeof kind } {
  return {
    kind,
    screen: world,
    world,
    isShiftPressed,
    isModPressed: false,
    zoom: 1,
    snapping: SNAPPING,
  };
}

/**
 * The line of the store.
 *
 * @param store - The store.
 * @param store.get - Reads an object.
 * @returns line-l.
 */
function lineOf(store: { get(id: ObjectId): unknown }): LineObject {
  return store.get(LINE) as LineObject;
}

describe('LineEndpoints', () => {
  it('shows a handle on each end of a lone unlocked line, and no frame', () => {
    const { endpoints } = editing();
    const overlay = endpoints.overlay();
    expect(overlay).toMatchObject({ frame: undefined });
    expect(overlay?.toolRects).toHaveLength(4);
    expect(overlay?.toolRects?.[0]?.box).toMatchObject({ x: -4, y: 496, width: 8 });
    expect(overlay?.toolRects?.[2]?.box).toMatchObject({ x: 96, y: 546 });
  });

  it('shows nothing for a locked line, a multi-selection or another type', () => {
    expect(editing([LINE, id('rect-a')]).endpoints.overlay()).toBeUndefined();
    expect(editing([id('rect-a')]).endpoints.overlay()).toBeUndefined();
    const { endpoints, store } = editing();
    runCommand(store, ADA, setLockedCommand, { ids: [LINE], locked: true }, ENVIRONMENT);
    expect(endpoints.overlay()).toBeUndefined();
    expect(endpoints.press(input('pointerDown', { x: 100, y: 550 }), 1)).toBe(false);
  });

  it('drags an end onto an anchor and writes it as one setLinePoints', () => {
    const { endpoints, store, record } = editing();
    expect(endpoints.press(input('pointerDown', { x: 102, y: 549 }), 1)).toBe(true);
    expect(endpoints.isDragging).toBe(true);
    // rect-a's bottom edge midpoint is (50, 50).
    endpoints.follow(input('pointerMove', { x: 53, y: 47 }));
    expect(record.previews.get(LINE)).toMatchObject({
      points: [
        { x: 0, y: 0 },
        { x: 50, y: -450 },
      ],
    });
    expect(lineOf(store).points[1]).toEqual({ x: 100, y: 50 });
    endpoints.follow(input('pointerUp', { x: 53, y: 47 }));
    expect(endpoints.isDragging).toBe(false);
    expect(lineEndsOf(lineOf(store), storeSource(store))).toEqual([
      { x: 0, y: 500 },
      { x: 50, y: 50 },
    ]);
    expect(record.commands).toBe(1);
    expect(record.previews.get(LINE)).toBeUndefined();
  });

  it('drags the start, keeping the end where it is', () => {
    const { endpoints, store } = editing();
    endpoints.press(input('pointerDown', { x: 0, y: 500 }), 1);
    endpoints.follow(input('pointerMove', { x: -40, y: 600 }));
    endpoints.follow(input('pointerUp', { x: -40, y: 600 }));
    expect(lineEndsOf(lineOf(store), storeSource(store))).toEqual([
      { x: -40, y: 600 },
      { x: 100, y: 550 },
    ]);
  });

  it('turns the dragged end to 45° about the other with Shift', () => {
    const { endpoints, store } = editing();
    endpoints.press(input('pointerDown', { x: 100, y: 550 }), 1);
    endpoints.follow(input('pointerUp', { x: 200, y: 510 }, true));
    const [, end] = lineEndsOf(lineOf(store), storeSource(store));
    expect(end.y).toBeCloseTo(500, 9);
    expect(end.x).toBeCloseTo(Math.hypot(200, 10), 9);
  });

  it('takes no press away from a handle, and writes nothing for a click on one', () => {
    const { endpoints, store, record } = editing();
    expect(endpoints.press(input('pointerDown', { x: 50, y: 525 }), 1)).toBe(false);
    const before = store.encodeState();
    endpoints.press(input('pointerDown', { x: 100, y: 550 }), 1);
    endpoints.follow(input('pointerUp', { x: 101, y: 551 }));
    expect(store.encodeState()).toEqual(before);
    expect(record.commands).toBe(0);
  });

  it('drops a cancelled drag (a second finger) without writing', () => {
    const { endpoints, store, record } = editing();
    const before = store.encodeState();
    endpoints.press(input('pointerDown', { x: 100, y: 550 }), 1);
    endpoints.follow(input('pointerMove', { x: 300, y: 300 }));
    endpoints.follow({ kind: 'pointerCancel' });
    expect(endpoints.isDragging).toBe(false);
    expect(store.encodeState()).toEqual(before);
    expect(record.previews.get(LINE)).toBeUndefined();
  });

  it('reports a refusal when the line was locked mid-drag', () => {
    const { endpoints, store, record } = editing();
    endpoints.press(input('pointerDown', { x: 100, y: 550 }), 1);
    endpoints.follow(input('pointerMove', { x: 300, y: 300 }));
    runCommand(store, ADA, setLockedCommand, { ids: [LINE], locked: true }, ENVIRONMENT);
    endpoints.follow(input('pointerUp', { x: 300, y: 300 }));
    expect(record.refusals.map((errors) => errors.map(({ code }) => code))).toEqual([['locked']]);
    expect(lineOf(store).points[1]).toEqual({ x: 100, y: 50 });
  });

  it('shrinks a short line’s handle squares so its middle third is body', () => {
    const { endpoints } = editing();
    // line-l spans 100 across: at half zoom a finger's squares would reach 44 world units from
    // each end, over the line's middle; they reach a third of the span instead.
    expect(endpoints.handleAt({ x: 62, y: 531 }, 0.5, 'touch')).toBeUndefined();
    expect(endpoints.handleAt({ x: 70, y: 535 }, 0.5, 'touch')).toBe(1);
    expect(endpoints.handleAt({ x: 30, y: 515 }, 0.5, 'touch')).toBe(0);
    // A long line on screen keeps the whole square.
    expect(endpoints.handleAt({ x: 90, y: 540 }, 1, 'touch')).toBe(1);
  });

  it('keeps whole handles on a line whose ends coincide, so an end can be pulled out', () => {
    const { endpoints, store } = editing();
    // A merge of two end drags onto one point leaves the line with no length.
    store.transact(ADA, (transaction) => {
      transaction.patchObject(LINE, {
        points: [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ],
      });
    });
    expect(endpoints.overlay()?.toolRects).toHaveLength(4);
    expect(endpoints.handleAt({ x: 5, y: 504 }, 1)).toBe(1);
    expect(endpoints.press(input('pointerDown', { x: 5, y: 504 }), 1)).toBe(true);
    endpoints.follow(input('pointerUp', { x: 80, y: 560 }));
    expect(lineEndsOf(lineOf(store), storeSource(store))).toEqual([
      { x: 0, y: 500 },
      { x: 80, y: 560 },
    ]);
  });

  it('redraws its handles for a new zoom only while they show', () => {
    expect(editing().endpoints.followZoom(2)).toBe(true);
    expect(editing([id('rect-a')]).endpoints.followZoom(2)).toBe(false);
  });

  it('ignores a held finger mid-drag, and marks the anchor and guides a dragged end snaps to', () => {
    const { endpoints } = editing();
    endpoints.press(input('pointerDown', { x: 100, y: 550 }), 1);
    endpoints.follow({ kind: 'hold', timeStamp: 0, screen: { x: 100, y: 550 }, zoom: 1 });
    expect(endpoints.isDragging).toBe(true);
    endpoints.follow(input('pointerMove', { x: 53, y: 47 }));
    // Two handles, then the marker on rect-a's bottom edge midpoint.
    expect(endpoints.overlay()?.toolRects).toHaveLength(5);
    const camera = {
      x: -500,
      y: -500,
      zoom: 1,
      viewportWidthPx: 2000,
      viewportHeightPx: 2000,
      dpr: 1,
    };
    endpoints.follow({ ...input('pointerMove', { x: 20, y: 53 }), camera });
    expect(endpoints.overlay()?.guides?.length).toBeGreaterThan(0);
  });

  it('writes without an undo capture when it has none', () => {
    const { store, context } = lineToolContext();
    const { capture: unused, ...uncaptured } = context;
    const endpoints = new LineEndpoints({
      ...uncaptured,
      source: storeSource(store),
      selection: () => [LINE],
    });
    endpoints.press(input('pointerDown', { x: 100, y: 550 }), 1);
    endpoints.follow(input('pointerUp', { x: 300, y: 300 }));
    expect(lineOf(store).points[1]).toEqual({ x: 300, y: -200 });
    expect(unused).toBeDefined();
  });

  it('keeps the handles on the line until the drag passes the click threshold', () => {
    const { endpoints } = editing();
    endpoints.press(input('pointerDown', { x: 100, y: 550 }), 1);
    endpoints.follow(input('pointerMove', { x: 101, y: 551 }));
    expect(endpoints.overlay()?.toolRects?.[2]?.box).toMatchObject({ x: 96, y: 546 });
  });

  it('does nothing with input or a cancel while no end is dragged', () => {
    const { endpoints, record } = editing();
    endpoints.follow(input('pointerMove', { x: 300, y: 300 }));
    endpoints.cancel();
    expect(endpoints.isDragging).toBe(false);
    expect(record.previews.size).toBe(0);
    expect(endpoints.followZoom(1)).toBe(false);
  });
});

describe('LineEndpoints with a collaborator editing the line mid-drag', () => {
  it('shows a move of the line and keeps it: the other end moved, the dragged end at the pointer', () => {
    const { endpoints, store, record } = editing();
    endpoints.press(input('pointerDown', { x: 100, y: 550 }), 1);
    endpoints.follow(input('pointerMove', { x: 300, y: 300 }));
    const move = { moves: [{ id: LINE, by: { x: 200, y: 0 } }] };
    runCommand(store, ADA, moveObjectsCommand, move, ENVIRONMENT);
    endpoints.follow(input('pointerMove', { x: 310, y: 300 }));
    // The preview is in the moved line's frame: its start stays on (200, 500).
    expect(record.previews.get(LINE)).toMatchObject({
      x: 200,
      points: [
        { x: 0, y: 0 },
        { x: 110, y: -200 },
      ],
    });
    expect(endpoints.overlay()?.toolRects?.[0]?.box).toMatchObject({ x: 196, y: 496 });
    endpoints.follow(input('pointerUp', { x: 310, y: 300 }));
    expect(lineEndsOf(lineOf(store), storeSource(store))).toEqual([
      { x: 200, y: 500 },
      { x: 310, y: 300 },
    ]);
  });

  it('shows a drag of the other end and keeps it', () => {
    const { endpoints, store, record } = editing();
    endpoints.press(input('pointerDown', { x: 100, y: 550 }), 1);
    const other = { id: LINE, end: 0, point: { x: -50, y: 480 } } as const;
    runCommand(store, ADA, setLinePointsCommand, other, ENVIRONMENT);
    endpoints.follow(input('pointerMove', { x: 300, y: 300 }));
    expect(record.previews.get(LINE)).toMatchObject({
      points: [
        { x: -50, y: -20 },
        { x: 300, y: -200 },
      ],
    });
    endpoints.follow(input('pointerUp', { x: 300, y: 300 }));
    expect(lineEndsOf(lineOf(store), storeSource(store))).toEqual([
      { x: -50, y: 480 },
      { x: 300, y: 300 },
    ]);
  });

  it('ends the drag, writing nothing, when the line is deleted meanwhile', () => {
    const { endpoints, store, record } = editing();
    endpoints.press(input('pointerDown', { x: 100, y: 550 }), 1);
    endpoints.follow(input('pointerMove', { x: 300, y: 300 }));
    runCommand(store, ADA, deleteObjectsCommand, { ids: [LINE] }, ENVIRONMENT);
    expect(endpoints.overlay()).toBeUndefined();
    endpoints.follow(input('pointerUp', { x: 310, y: 300 }));
    expect(endpoints.isDragging).toBe(false);
    expect(record.previews.get(LINE)).toBeUndefined();
    expect(record.commands).toBe(0);
  });

  it('reports the refusal of an end dropped on the other end', () => {
    const { endpoints, store, record } = editing();
    const before = store.encodeState();
    endpoints.press(input('pointerDown', { x: 100, y: 550 }), 1);
    endpoints.follow({
      ...input('pointerUp', { x: 0, y: 500 }),
      snapping: { isEnabled: false, isGridVisible: false },
    });
    expect(record.refusals.map((errors) => errors.map(({ code }) => code))).toEqual([
      ['invalid-input'],
    ]);
    expect(store.encodeState()).toEqual(before);
  });
});
