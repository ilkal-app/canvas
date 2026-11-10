import { describe, expect, it } from 'vitest';

import type { ConnectorObject, ObjectId, Point } from '@canvas/schema';

import type { ToolPointerInput } from '../modes/tool-mode.js';
import { ADA } from '../select/__fixtures__/select-store.js';

import { ARROW_STYLE, connectorToolContext } from './__fixtures__/connector-tool-context.js';
import { ConnectorLabelDrag, routeFractionAt } from './connector-label-drag.js';

// The select board's connector-k runs from (100, 25) to (420, 45): its label sits at (260, 35).
const CONNECTOR = 'connector-k' as ObjectId;
const LABEL_POINT = { x: 260, y: 35 };
const LABEL = {
  text: 'Hi',
  runs: [
    {
      length: 2,
      style: {
        fontFamily: 'Liberation Sans',
        fontSize: 16,
        color: [0, 0, 0, 1],
        weight: 400,
        italic: false,
      },
    },
  ],
} as const;

/**
 * A pointer input at zoom 1.
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
    snapping: { isEnabled: false, isGridVisible: false },
    camera: { x: 0, y: 0, zoom: 1, viewportWidthPx: 1000, viewportHeightPx: 800, dpr: 1 },
  };
}

/**
 * Label dragging over the select board, connector-k labelled.
 *
 * @param options - Whether edits run through an undo capture, and whether there is an index.
 * @param options.hasCapture - Through a capture; true if absent.
 * @param options.hasIndex - With the snap index; true if absent.
 * @returns The store, the editor and what was recorded.
 */
function setUp(options: { hasCapture?: boolean; hasIndex?: boolean } = {}) {
  const { store, context, record } = connectorToolContext(ARROW_STYLE, options.hasCapture ?? true);
  store.transact(ADA, (transaction) => {
    transaction.patchObject(CONNECTOR, { label: LABEL } as never);
  });
  const { snapIndex, ...rest } = context;
  const editor = new ConnectorLabelDrag(
    options.hasIndex === false ? rest : { ...rest, ...(snapIndex && { snapIndex }) },
  );
  const connector = (): ConnectorObject | undefined => {
    const object = store.get(CONNECTOR);
    return object?.type === 'connector' ? object : undefined;
  };
  return { store, editor, record, connector };
}

describe('ConnectorLabelDrag', () => {
  it('takes a press on a label only', () => {
    const { editor, store } = setUp();
    expect(editor.handleAt(LABEL_POINT)).toBe(CONNECTOR);
    expect(editor.press(input('pointerDown', { x: 200, y: 200 }))).toBe(false);
    expect(setUp({ hasIndex: false }).editor.handleAt(LABEL_POINT)).toBeUndefined();
    store.transact(ADA, (transaction) => {
      transaction.patchObject(CONNECTOR, { locked: true });
    });
    expect(editor.handleAt(LABEL_POINT)).toBeUndefined();
    store.transact(ADA, (transaction) => {
      transaction.patchObject(CONNECTOR, { locked: false, label: null });
    });
    expect(editor.handleAt(LABEL_POINT)).toBeUndefined();
  });

  it('previews the label along the route and writes it once on release', () => {
    const { editor, record, connector } = setUp();
    expect(editor.press(input('pointerDown', LABEL_POINT))).toBe(true);
    expect(editor.isDragging).toBe(true);
    editor.follow({ kind: 'hold' } as ToolPointerInput);
    editor.follow(input('pointerMove', { x: 340, y: 60 }));
    const preview = record.previews.get(CONNECTOR) as ConnectorObject | undefined;
    expect(preview?.labelPosition).toBeCloseTo(0.75, 1);
    editor.follow(input('pointerUp', { x: 900, y: 45 }));
    expect(editor.isDragging).toBe(false);
    expect(record.previews.get(CONNECTOR)).toBeUndefined();
    expect(connector()?.labelPosition).toBe(1);
    expect(record.commands).toBe(1);
    expect(editor.takeClick()).toBeUndefined();
  });

  it('hands a click back to the select tool and writes nothing', () => {
    const { editor, record, connector } = setUp();
    editor.press(input('pointerDown', LABEL_POINT));
    editor.follow(input('pointerUp', LABEL_POINT));
    expect(editor.takeClick()?.map((each) => each.kind)).toEqual(['pointerDown', 'pointerUp']);
    expect(editor.takeClick()).toBeUndefined();
    expect(connector()?.labelPosition).toBeUndefined();
    expect(record.commands).toBe(0);
  });

  it('writes nothing for a release where the label already is, or without a capture', () => {
    const same = setUp();
    same.editor.press(input('pointerDown', LABEL_POINT));
    same.editor.follow(input('pointerUp', { x: 100, y: 25 }));
    expect(same.connector()?.labelPosition).toBe(0);
    // Its label now at the start: a press there dropped at the start again writes nothing.
    same.editor.press(input('pointerDown', { x: 100, y: 25 }));
    same.editor.follow(input('pointerMove', { x: 90, y: 60 }));
    same.editor.follow(input('pointerUp', { x: 60, y: 25 }));
    expect(same.record.commands).toBe(1);
    const bare = setUp({ hasCapture: false });
    bare.editor.press(input('pointerDown', LABEL_POINT));
    bare.editor.follow(input('pointerUp', { x: 100, y: 25 }));
    expect(bare.connector()?.labelPosition).toBe(0);
  });

  it('drops the drag on a cancel, a lost connector, and reports a refusal', () => {
    const cancelled = setUp();
    cancelled.editor.press(input('pointerDown', LABEL_POINT));
    cancelled.editor.follow(input('pointerMove', { x: 300, y: 40 }));
    cancelled.editor.follow({ kind: 'pointerCancel' });
    expect(cancelled.editor.isDragging).toBe(false);
    expect(cancelled.record.previews.get(CONNECTOR)).toBeUndefined();
    cancelled.editor.cancel();
    cancelled.editor.follow(input('pointerMove', LABEL_POINT));
    const lost = setUp();
    lost.editor.press(input('pointerDown', LABEL_POINT));
    lost.store.transact(ADA, (transaction) => {
      transaction.deleteObject(CONNECTOR);
    });
    lost.editor.follow(input('pointerMove', { x: 300, y: 40 }));
    expect(lost.editor.isDragging).toBe(false);
    // The scene still draws a connector the document has lost: the write is refused.
    const refused = setUp();
    const shown = refused.connector();
    const { context } = connectorToolContext(ARROW_STYLE);
    const stale = new ConnectorLabelDrag({
      ...context,
      store: refused.store,
      onCommandRefused: (errors) => {
        refused.record.refusals.push(errors);
      },
      source: {
        ...context.source,
        get: (id) => (id === CONNECTOR ? shown : context.source.get(id)),
      },
    });
    stale.press(input('pointerDown', LABEL_POINT));
    refused.store.transact(ADA, (transaction) => {
      transaction.deleteObject(CONNECTOR);
    });
    stale.follow(input('pointerUp', { x: 120, y: 26 }));
    expect(refused.record.refusals).toHaveLength(1);
  });

  it('adds nothing over the overlay and nothing to redraw at a new zoom', () => {
    const { editor } = setUp();
    expect(editor.overlay()).toBeUndefined();
    expect(editor.followZoom()).toBe(false);
  });
});

describe('routeFractionAt', () => {
  it('measures the nearest point by length, and is 0 for a route without length', () => {
    const route = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    expect(routeFractionAt(route, { x: 50, y: -10 })).toBe(0.25);
    expect(routeFractionAt(route, { x: 140, y: 50 })).toBe(0.75);
    expect(routeFractionAt(route, { x: 200, y: 300 })).toBe(1);
    expect(routeFractionAt([], { x: 0, y: 0 })).toBe(0);
    expect(
      routeFractionAt(
        [
          { x: 5, y: 5 },
          { x: 5, y: 5 },
        ],
        { x: 0, y: 0 },
      ),
    ).toBe(0);
  });
});
