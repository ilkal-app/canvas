// Endpoint dragging can free the second end of a connector.
import { describe, expect, it } from 'vitest';

import type { ObjectId, Point } from '@canvas/schema';

import type { ToolPointerInput } from '../modes/tool-mode.js';

import { ARROW_STYLE, connectorToolContext } from './__fixtures__/connector-tool-context.js';
import { ConnectorEndpoints, connectorEndsOf } from './connector-endpoints.js';

const CONNECTOR = 'connector-k' as ObjectId;

function pointer(
  kind: 'pointerDown' | 'pointerMove' | 'pointerUp',
  point: Point,
): Exclude<ToolPointerInput, { readonly kind: 'hold' | 'pointerCancel' }> {
  return {
    kind,
    screen: point,
    world: point,
    isShiftPressed: false,
    isModPressed: false,
    zoom: 1,
    snapping: { isEnabled: true, isGridVisible: false },
    camera: { x: 0, y: 0, zoom: 1, viewportWidthPx: 1000, viewportHeightPx: 800, dpr: 1 },
  };
}

describe('connector endpoint drag', () => {
  it('writes one setConnectorEnd when an end is freed beside a free end', () => {
    const { store, context, record } = connectorToolContext(ARROW_STYLE);
    const editor = new ConnectorEndpoints({ ...context, selection: () => [CONNECTOR] });
    const drag = (from: Point, to: Point) => {
      expect(editor.press(pointer('pointerDown', from), 1)).toBe(true);
      editor.follow(pointer('pointerMove', to));
      editor.follow(pointer('pointerUp', to));
    };
    drag({ x: 100, y: 25 }, { x: 300, y: 400 });
    const partlyFree = store.get(CONNECTOR);
    if (partlyFree?.type !== 'connector') throw new Error('Missing connector');
    expect(partlyFree.from).toEqual({ kind: 'point', x: 300, y: 400 });
    const placed = connectorEndsOf(partlyFree, {
      get: (id: ObjectId) => store.get(id),
      childrenOf: (id: ObjectId) => store.references.childrenOf(id),
    });
    const beforeSecondDrag = record.commands;
    drag(placed.to, { x: 600, y: 400 });
    expect(store.get(CONNECTOR)).toMatchObject({
      from: { kind: 'point', x: 300, y: 400 },
      to: { kind: 'point', x: 600, y: 400 },
    });
    expect(record.commands - beforeSecondDrag).toBe(1);
    expect(record.previews.get(CONNECTOR)).toBeUndefined();
  });
});
