import { describe, expect, it, vi } from 'vitest';

import type { ConnectorObject, ObjectId, Point } from '@canvas/schema';

import type { ToolPointerInput } from '../modes/tool-mode.js';
import { ADA } from '../select/__fixtures__/select-store.js';
import type { OverlayPalette } from '../select/overlay-palette.js';
import { SELECTION_COLOR } from '../select/overlay-rects.js';
import type { SelectPointer } from '../select/select-input.js';

import { ARROW_STYLE, connectorToolContext } from './__fixtures__/connector-tool-context.js';
import { ConnectorMode, isConnectable } from './connector-mode.js';

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
    camera: { x: 0, y: 0, zoom: 1, viewportWidthPx: 1000, viewportHeightPx: 800, dpr: 1 },
    ...modifiers,
  };
}

/**
 * Drags from one point to another and releases.
 *
 * @param mode - The connector tool.
 * @param from - The press.
 * @param to - The release.
 * @param modifiers - Held through the drag.
 * @returns The release's step.
 */
function drag(mode: ConnectorMode, from: Point, to: Point, modifiers: Modifiers = {}) {
  mode.onPointer(input('pointerDown', from, modifiers));
  mode.onPointer(input('pointerMove', to, modifiers));
  return mode.onPointer(input('pointerUp', to, modifiers));
}

/**
 * The connector a store holds under an id.
 *
 * @param store - The store.
 * @param store.get - Reads an object.
 * @param id - The id.
 * @returns The connector, if it is one.
 */
function connectorIn(
  store: { get(id: ObjectId): unknown },
  id = 'new-1',
): ConnectorObject | undefined {
  const object = store.get(id as ObjectId) as ConnectorObject | undefined;
  return object?.type === 'connector' ? object : undefined;
}

// The select board: rect-a 100 × 50 at (0, 0), anchors (50, 25), (50, 0), (100, 25), (50, 50) and
// (0, 25); rect-locked 50 × 50 at (800, 0); rect-c 50 × 50 at (420, 20), inside frame-f.
const ON_RECT_A = { x: 30, y: 10 };
const ON_RECT_LOCKED = { x: 810, y: 40 };

describe('ConnectorMode', () => {
  it('connects two objects by drag as one connect, selects it and hands back to select', () => {
    const { store, context, record } = connectorToolContext();
    const mode = new ConnectorMode(context);
    mode.onPointer(input('pointerDown', ON_RECT_A));
    mode.onPointer(input('pointerMove', ON_RECT_LOCKED));
    expect(record.previews.get('new-1' as ObjectId)).toMatchObject({
      type: 'connector',
      from: { kind: 'object', objectId: 'rect-a', anchor: null },
      to: { kind: 'object', objectId: 'rect-locked', anchor: null },
      z: '~',
      createdBy: ADA.principalId,
    });
    expect(connectorIn(store)).toBeUndefined();
    const step = mode.onPointer(input('pointerUp', ON_RECT_LOCKED));
    expect(step.isDone).toBe(true);
    expect(connectorIn(store)).toMatchObject({
      parentId: null,
      x: 0,
      y: 0,
      rotation: 0,
      from: { kind: 'object', objectId: 'rect-a', anchor: null },
      to: { kind: 'object', objectId: 'rect-locked', anchor: null },
      label: null,
      ...ARROW_STYLE,
    });
    expect(record.commands).toBe(1);
    expect(record.selected).toEqual([['new-1']]);
    expect(record.previews.get('new-1' as ObjectId)).toBeUndefined();
  });

  it('attaches an end that lands on an anchor there, as a fixed anchor', () => {
    const { store, context } = connectorToolContext();
    // 3 px off rect-a's right edge midpoint (100, 25), and rect-c's top midpoint (445, 20).
    drag(new ConnectorMode(context), { x: 103, y: 27 }, { x: 448, y: 22 });
    expect(connectorIn(store)).toMatchObject({
      from: { kind: 'object', objectId: 'rect-a', anchor: { x: 1, y: 0.5 } },
      to: { kind: 'object', objectId: 'rect-c', anchor: { x: 0.5, y: 0 } },
    });
  });

  it('attaches automatically over an anchor with the snap modifier held', () => {
    const { store, context } = connectorToolContext();
    drag(new ConnectorMode(context), { x: 97, y: 27 }, ON_RECT_LOCKED, { isSnapSuspended: true });
    expect(connectorIn(store)?.from).toEqual({ kind: 'object', objectId: 'rect-a', anchor: null });
  });

  it('starts from a free point on the board and ends on an object, and the other way', () => {
    const { store, context } = connectorToolContext();
    drag(new ConnectorMode(context), { x: 300, y: 400 }, ON_RECT_A);
    expect(connectorIn(store)).toMatchObject({
      from: { kind: 'point', x: 300, y: 400 },
      to: { kind: 'object', objectId: 'rect-a', anchor: null },
    });
    const second = connectorToolContext();
    drag(new ConnectorMode(second.context), ON_RECT_A, { x: 300, y: 400 });
    expect(connectorIn(second.store)?.to).toEqual({ kind: 'point', x: 300, y: 400 });
  });

  it('turns a free end to 45° about the start with Shift', () => {
    const { store, context } = connectorToolContext();
    drag(
      new ConnectorMode(context),
      { x: 300, y: 400 },
      { x: 400, y: 410 },
      {
        isShiftPressed: true,
      },
    );
    // From a free point: a free line, its end turned to the nearest 45° (here level).
    const line = connectorIn(store);
    expect(line?.to.kind).toBe('point');
    if (line?.to.kind === 'point' && line.from.kind === 'point') {
      expect(line.to.y).toBeCloseTo(line.from.y);
    }
    const second = connectorToolContext();
    drag(
      new ConnectorMode(second.context),
      { x: 103, y: 27 },
      { x: 300, y: 40 },
      {
        isShiftPressed: true,
      },
    );
    const to = connectorIn(second.store)?.to;
    expect(to?.kind).toBe('point');
    if (to?.kind === 'point') expect(to.y).toBeCloseTo(25, 9);
  });

  it('draws a free line between two free points, previewing it on the way', () => {
    const { store, context, record } = connectorToolContext();
    const mode = new ConnectorMode(context);
    mode.onPointer(input('pointerDown', { x: 300, y: 400 }));
    mode.onPointer(input('pointerMove', { x: 350, y: 450 }));
    expect(record.previews.get('new-1' as ObjectId)).toBeDefined();
    const step = mode.onPointer(input('pointerUp', { x: 350, y: 450 }));
    expect(step.isDone).toBe(true);
    const connector = connectorIn(store);
    expect([connector?.from.kind, connector?.to.kind]).toEqual(['point', 'point']);
    expect(record.commands).toBe(1);
  });

  it('draws nothing with both ends on one object, or on a click', () => {
    const { store, context, record } = connectorToolContext();
    const mode = new ConnectorMode(context);
    expect(drag(mode, ON_RECT_A, { x: 80, y: 40 }).isDone).toBe(false);
    expect(drag(mode, ON_RECT_A, { x: 31, y: 11 }).isDone).toBe(false);
    expect(connectorIn(store, 'new-1')).toBeUndefined();
    expect(connectorIn(store, 'new-2')).toBeUndefined();
    expect(record.selected).toEqual([]);
  });

  it('drops a drag on Escape or a cancel, and leaves the tool on Escape with none', () => {
    const { store, context, record } = connectorToolContext();
    const mode = new ConnectorMode(context);
    mode.onPointer(input('pointerDown', ON_RECT_A));
    mode.onPointer(input('pointerMove', ON_RECT_LOCKED));
    expect(mode.onKey({ kind: 'escape' })).toBe(true);
    expect(record.previews.get('new-1' as ObjectId)).toBeUndefined();
    expect(mode.onPointer(input('pointerUp', ON_RECT_LOCKED)).isDone).toBe(false);
    mode.onPointer(input('pointerDown', ON_RECT_A));
    mode.onPointer(input('pointerMove', ON_RECT_LOCKED));
    expect(mode.onPointer({ kind: 'pointerCancel' }).isDone).toBe(false);
    expect(record.previews.get('new-2' as ObjectId)).toBeUndefined();
    expect(record.exitRequests).toBe(0);
    expect(mode.onKey({ kind: 'escape' })).toBe(true);
    expect(record.exitRequests).toBe(1);
    expect(mode.onKey({ kind: 'enter' })).toBe(false);
    expect(store.get('new-1' as ObjectId)).toBeUndefined();
  });

  it('ignores a held finger and a secondary click, and drops a drag when left', () => {
    const { context, record } = connectorToolContext();
    const mode = new ConnectorMode(context);
    const hold = { kind: 'hold', timeStamp: 1, screen: { x: 0, y: 0 }, zoom: 1 } as const;
    expect(mode.onPointer(hold).isDone).toBe(false);
    expect(
      mode.onPointer({ ...input('pointerDown', ON_RECT_A), kind: 'contextPress' }).isDone,
    ).toBe(false);
    mode.onPointer(input('pointerDown', ON_RECT_A));
    mode.onPointer(input('pointerMove', ON_RECT_LOCKED));
    mode.exit();
    expect(record.previews.get('new-1' as ObjectId)).toBeUndefined();
    expect(mode.cursor).toBe('crosshair');
    expect(mode.id).toBe('connector');
  });

  it('tells the shell when the document refuses the connector, and selects nothing', () => {
    const { store, context, record } = connectorToolContext(ARROW_STYLE, false);
    const mode = new ConnectorMode(context);
    mode.onPointer(input('pointerDown', ON_RECT_A));
    mode.onPointer(input('pointerMove', ON_RECT_LOCKED));
    // A collaborator deletes the start's target before the release.
    store.transact(ADA, (transaction) => {
      transaction.deleteObject('rect-a' as ObjectId);
    });
    // The start's target has no box any longer: only the end's anchors are marked.
    expect(mode.overlay().toolRects).toHaveLength(10);
    expect(mode.onPointer(input('pointerUp', ON_RECT_LOCKED)).isDone).toBe(true);
    expect(record.refusals).toHaveLength(1);
    expect(record.selected).toEqual([]);
    expect(connectorIn(store)).toBeUndefined();
  });

  it('marks the anchors of the object a hovered end is on, and the anchor it landed on', () => {
    const { context } = connectorToolContext();
    const mode = new ConnectorMode(context);
    mode.onPointer(input('pointerMove', { x: 300, y: 400 }));
    expect(mode.overlay()).toEqual({ toolRects: [] });
    mode.onPointer(input('pointerMove', ON_RECT_A));
    // A handle (border and inside) on each of rect-a's five anchors.
    expect(mode.overlay().toolRects).toHaveLength(10);
    mode.onPointer(input('pointerMove', { x: 101, y: 26 }));
    const rects = mode.overlay().toolRects ?? [];
    expect(rects).toHaveLength(11);
    expect(rects.at(-1)?.color).toEqual(SELECTION_COLOR);
    mode.onPointer(input('pointerDown', ON_RECT_A));
    mode.onPointer(input('pointerMove', ON_RECT_LOCKED));
    expect(mode.overlay().toolRects).toHaveLength(20);
  });

  it('outlines the object a dragged end would attach to and says release to connect', () => {
    const palette: OverlayPalette = {
      you: [0.89, 0.66, 0.23, 1],
      guide: [0.88, 0.39, 0.35, 1],
      hover: [0.64, 0.64, 0.61, 1],
      locked: [0.42, 0.42, 0.4, 1],
    };
    const { context } = connectorToolContext();
    const themed = new ConnectorMode({
      ...context,
      creationInk: { theme: () => 'dark', overlayPalette: () => palette },
    });
    themed.onPointer(input('pointerDown', ON_RECT_A));
    themed.onPointer(input('pointerMove', { x: 300, y: 400 }));
    // A free end: no target, no label.
    expect(themed.overlay().labels).toBeUndefined();
    themed.onPointer(input('pointerMove', ON_RECT_LOCKED));
    const overlay = themed.overlay();
    expect(overlay.labels).toEqual([
      { kind: 'connect', text: 'Release to connect', at: ON_RECT_LOCKED },
    ]);
    // rect-locked's outline in the palette's you, under both ends' anchors.
    const outline = overlay.toolRects?.slice(0, 4) ?? [];
    expect(outline.every(({ color }) => color === palette.you)).toBe(true);
    expect(outline[0]?.box).toMatchObject({ x: 799, y: -1, width: 52, height: 1 });
    expect(overlay.toolRects).toHaveLength(4 + 20);
    // Without the shell's palette, the anchors alone, and still the label.
    const plain = new ConnectorMode(context);
    plain.onPointer(input('pointerDown', ON_RECT_A));
    plain.onPointer(input('pointerMove', ON_RECT_LOCKED));
    expect(plain.overlay().toolRects).toHaveLength(20);
    expect(plain.overlay().labels).toHaveLength(1);
  });

  it('shows the guides a free end snapped to', () => {
    const { context } = connectorToolContext();
    const mode = new ConnectorMode(context);
    // 2 px right of rect-a's right edge, below it: snapped onto the edge's line.
    mode.onPointer(input('pointerMove', { x: 102, y: 90 }));
    expect(mode.overlay().guides?.length).toBeGreaterThan(0);
  });

  it('redraws its markers at a new zoom only while it shows some', () => {
    const { context } = connectorToolContext();
    const onChange = vi.fn();
    const mode = new ConnectorMode({ ...context, onChange });
    mode.onZoom(1);
    mode.onZoom(2);
    expect(onChange).not.toHaveBeenCalled();
    mode.onPointer(input('pointerMove', ON_RECT_A));
    mode.onZoom(2);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('isConnectable', () => {
  const free = { kind: 'point', point: { x: 0, y: 0 }, guides: [] } as const;
  const onA = {
    kind: 'object',
    objectId: 'a' as ObjectId,
    anchor: null,
    point: { x: 0, y: 0 },
  } as const;
  const onB = { ...onA, objectId: 'b' as ObjectId };

  it('takes two free points (a free line), and two different objects when both are', () => {
    expect(isConnectable(free, free)).toBe(true);
    expect(isConnectable(free, onA)).toBe(true);
    expect(isConnectable(onA, free)).toBe(true);
    expect(isConnectable(onA, onA)).toBe(false);
    expect(isConnectable(onA, onB)).toBe(true);
  });
});
