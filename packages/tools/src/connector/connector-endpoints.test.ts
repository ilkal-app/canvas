import { describe, expect, it } from 'vitest';

import type { ConnectorObject, ObjectId, Point } from '@canvas/schema';

import type { ToolPointerInput } from '../modes/tool-mode.js';
import { ADA } from '../select/__fixtures__/select-store.js';

import { ARROW_STYLE, connectorToolContext } from './__fixtures__/connector-tool-context.js';
import { ConnectorEndpoints, connectorEndsOf } from './connector-endpoints.js';

// The select board's connector-k runs from rect-a's right side (100, 25) to rect-c's left side
// (420, 45); rect-locked is 50 × 50 at (800, 0), rect-a 100 × 50 at (0, 0).

const CONNECTOR = 'connector-k' as ObjectId;
const FROM = { x: 100, y: 25 };
const TO = { x: 420, y: 45 };

/**
 * A pointer input at zoom 1, snapping on.
 *
 * @param kind - The input's kind.
 * @param world - The point.
 * @returns The input.
 */
function input(
  kind: 'pointerDown' | 'pointerMove' | 'pointerUp',
  world: Point,
): Exclude<ToolPointerInput, { readonly kind: 'hold' | 'pointerCancel' }> {
  return {
    kind,
    screen: world,
    world,
    isShiftPressed: false,
    isModPressed: false,
    zoom: 1,
    snapping: { isEnabled: true, isGridVisible: false },
    camera: { x: 0, y: 0, zoom: 1, viewportWidthPx: 1000, viewportHeightPx: 800, dpr: 1 },
  };
}

/**
 * End editing over the select board with a selection.
 *
 * @param selected - The selected ids; connector-k alone by default.
 * @param hasCapture - Whether edits run through an undo capture.
 * @returns The store, the editor and what was recorded.
 */
function setUp(selected: readonly string[] = [CONNECTOR], hasCapture = true) {
  const { store, context, record } = connectorToolContext(ARROW_STYLE, hasCapture);
  const editor = new ConnectorEndpoints({
    ...context,
    selection: () => selected as readonly ObjectId[],
  });
  const drag = (from: Point, to: Point) => {
    expect(editor.press(input('pointerDown', from), 1)).toBe(true);
    editor.follow(input('pointerMove', to));
    editor.follow(input('pointerUp', to));
  };
  const connector = (): ConnectorObject => {
    const object = store.get(CONNECTOR);
    if (object?.type !== 'connector') throw new Error('no connector-k');
    return object;
  };
  return { store, editor, record, drag, connector };
}

describe('ConnectorEndpoints', () => {
  it('edits a lone unlocked connector only', () => {
    expect(setUp().editor.editableConnector()?.id).toBe(CONNECTOR);
    expect(setUp([]).editor.editableConnector()).toBeUndefined();
    expect(setUp([CONNECTOR, 'rect-a']).editor.editableConnector()).toBeUndefined();
    expect(setUp(['rect-a']).editor.editableConnector()).toBeUndefined();
    const locked = setUp();
    locked.store.transact(ADA, (transaction) => {
      transaction.patchObject(CONNECTOR, { locked: true });
    });
    expect(locked.editor.editableConnector()).toBeUndefined();
    expect(locked.editor.handleAt(FROM, 1)).toBeUndefined();
    expect(locked.editor.overlay()).toBeUndefined();
  });

  it('finds a handle on each end where the connector draws it', () => {
    const { editor, connector, store } = setUp();
    expect(connectorEndsOf(connector(), { ...storeOf(store) })).toEqual({ from: FROM, to: TO });
    expect(editor.handleAt(FROM, 1)).toBe('from');
    expect(editor.handleAt({ x: 423, y: 47 }, 1)).toBe('to');
    expect(editor.handleAt({ x: 250, y: 35 }, 1)).toBeUndefined();
    expect(editor.handleAt({ x: 112, y: 25 }, 1)).toBeUndefined();
    expect(editor.handleAt({ x: 112, y: 25 }, 1, 'touch')).toBe('from');
    expect(editor.press(input('pointerDown', { x: 250, y: 35 }), 1)).toBe(false);
  });

  it('re-attaches a dragged end to the object it is released over, as one setConnectorEnd', () => {
    const { drag, connector, record } = setUp();
    drag(TO, { x: 810, y: 40 });
    expect(connector().to).toEqual({ kind: 'object', objectId: 'rect-locked', anchor: null });
    expect(connector().from).toEqual({ kind: 'object', objectId: 'rect-a', anchor: null });
    expect(record.commands).toBe(1);
    expect(record.previews.get(CONNECTOR)).toBeUndefined();
  });

  it('attaches at an anchor it is released on, and frees an end released on empty board', () => {
    const { drag, connector } = setUp();
    // 2 px off rect-locked's top edge midpoint (825, 0).
    drag(TO, { x: 826, y: 2 });
    expect(connector().to).toEqual({
      kind: 'object',
      objectId: 'rect-locked',
      anchor: { x: 0.5, y: 0 },
    });
    drag(FROM, { x: 300, y: 400 });
    expect(connector().from).toEqual({ kind: 'point', x: 300, y: 400 });
  });

  it('previews the dragged end, and writes nothing on a click', () => {
    const { editor, record, connector } = setUp();
    const before = connector();
    expect(editor.press(input('pointerDown', FROM), 1)).toBe(true);
    expect(editor.isDragging).toBe(true);
    editor.follow(input('pointerMove', { x: 101, y: 26 }));
    expect(record.previews.get(CONNECTOR)).toBeUndefined();
    editor.follow(input('pointerMove', { x: 300, y: 400 }));
    expect(record.previews.get(CONNECTOR)).toMatchObject({
      from: { kind: 'point', x: 300, y: 400 },
    });
    editor.follow(input('pointerMove', { x: 810, y: 40 }));
    expect(record.previews.get(CONNECTOR)).toMatchObject({
      from: { kind: 'object', objectId: 'rect-locked', anchor: null },
    });
    editor.follow(input('pointerUp', { x: 101, y: 26 }));
    expect(connector()).toEqual(before);
    expect(record.commands).toBe(0);
    expect(editor.isDragging).toBe(false);
  });

  it('writes nothing for an end dropped on the other end’s object, and frees one beside a free end', () => {
    const { drag, connector, record, store } = setUp();
    drag(FROM, { x: 440, y: 60 });
    expect(connector().from).toEqual({ kind: 'object', objectId: 'rect-a', anchor: null });
    drag(FROM, { x: 300, y: 400 });
    expect(record.commands).toBe(1);
    // The end now leaves rect-c's side nearest the free start.
    // Freed beside the free start, it makes a free line.
    drag(connectorEndsOf(connector(), storeOf(store)).to, { x: 600, y: 400 });
    expect(connector().to.kind).toBe('point');
    expect(record.commands).toBe(2);
  });

  it('drops a drag on a cancel, when the connector goes, and ignores other input', () => {
    const { editor, record, store } = setUp();
    editor.follow(input('pointerMove', TO));
    expect(editor.press(input('pointerDown', TO), 1)).toBe(true);
    editor.follow({ kind: 'hold', timeStamp: 1, screen: TO, zoom: 1 });
    editor.follow(input('pointerMove', { x: 300, y: 400 }));
    editor.follow({ kind: 'pointerCancel' });
    expect(editor.isDragging).toBe(false);
    expect(record.previews.get(CONNECTOR)).toBeUndefined();
    editor.cancel();
    expect(editor.press(input('pointerDown', TO), 1)).toBe(true);
    store.transact(ADA, (transaction) => {
      transaction.deleteObject(CONNECTOR);
    });
    editor.follow(input('pointerMove', { x: 300, y: 400 }));
    expect(editor.isDragging).toBe(false);
    expect(record.commands).toBe(0);
  });

  it('tells the shell when the document refuses the end, writing nothing', () => {
    const { editor, record, store, connector } = setUp([CONNECTOR], false);
    expect(editor.press(input('pointerDown', TO), 1)).toBe(true);
    editor.follow(input('pointerMove', { x: 810, y: 40 }));
    // A collaborator locks the connector before the release.
    store.transact(ADA, (transaction) => {
      transaction.patchObject(CONNECTOR, { locked: true });
    });
    editor.follow(input('pointerUp', { x: 810, y: 40 }));
    expect(record.refusals).toHaveLength(1);
    expect(connector().to).toEqual({ kind: 'object', objectId: 'rect-c', anchor: null });
  });

  it('shows a handle on each end in place of the frame, and where a dragged end lands', () => {
    const { editor } = setUp();
    expect(editor.overlay()).toMatchObject({ frame: undefined });
    expect(editor.overlay()?.toolRects).toHaveLength(4);
    expect(editor.press(input('pointerDown', TO), 1)).toBe(true);
    editor.follow(input('pointerMove', { x: 810, y: 40 }));
    // The two handles and rect-locked's five anchors.
    expect(editor.overlay()?.toolRects).toHaveLength(14);
    // 2 px right of rect-a's right edge, below it: snapped onto the edge's line.
    editor.follow(input('pointerMove', { x: 102, y: 300 }));
    expect(editor.overlay()?.guides?.length).toBeGreaterThan(0);
    editor.follow(input('pointerMove', { x: 300, y: 600 }));
    expect(editor.overlay()?.guides).toBeUndefined();
  });

  it('asks for a redraw at a new zoom only while its handles show', () => {
    const shown = setUp();
    expect(shown.editor.followZoom(1)).toBe(false);
    expect(shown.editor.followZoom(2)).toBe(true);
    expect(setUp([]).editor.followZoom(2)).toBe(false);
    expect(shown.editor.press(input('pointerDown', FROM), 2)).toBe(true);
    expect(shown.editor.followZoom(3)).toBe(true);
  });
});

/**
 * The store as the select tool reads it.
 *
 * @param store - The store.
 * @returns The source.
 */
function storeOf(store: ReturnType<typeof setUp>['store']) {
  return {
    get: (id: ObjectId) => store.get(id),
    childrenOf: (id: ObjectId) => store.references.childrenOf(id),
  };
}
