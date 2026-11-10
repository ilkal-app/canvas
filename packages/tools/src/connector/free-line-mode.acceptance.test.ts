// The connector tool draws and selects a free line from a drag on empty board.
import { describe, expect, it } from 'vitest';

import type { ObjectId, Point } from '@canvas/schema';

import type { ToolPointerInput } from '../modes/tool-mode.js';

import { ARROW_STYLE, connectorToolContext } from './__fixtures__/connector-tool-context.js';
import { ConnectorMode } from './connector-mode.js';

const FREE_STYLE = { ...ARROW_STYLE, route: 'curved' as const, endCap: 'none' as const };

function pointer(
  kind: 'pointerDown' | 'pointerMove' | 'pointerUp',
  point: Point,
  isShiftPressed = false,
): Exclude<ToolPointerInput, { readonly kind: 'hold' | 'pointerCancel' }> {
  return {
    kind,
    screen: point,
    world: point,
    isShiftPressed,
    isModPressed: false,
    zoom: 1,
    snapping: { isEnabled: true, isGridVisible: false },
    camera: { x: 0, y: 0, zoom: 1, viewportWidthPx: 1000, viewportHeightPx: 800, dpr: 1 },
  };
}

describe('connector tool', () => {
  it('previews and draws a free connector, then selects it and hands back to select', () => {
    const { store, context, record } = connectorToolContext(FREE_STYLE);
    const mode = new ConnectorMode(context);
    mode.onPointer(pointer('pointerDown', { x: 300, y: 400 }));
    mode.onPointer(pointer('pointerMove', { x: 500, y: 450 }));
    expect(record.previews.get('new-1' as ObjectId)).toMatchObject({
      type: 'connector',
      from: { kind: 'point', x: 300, y: 400 },
      to: { kind: 'point', x: 500, y: 450 },
      route: 'curved',
      endCap: 'none',
    });
    expect(store.get('new-1' as ObjectId)).toBeUndefined();
    expect(mode.onPointer(pointer('pointerUp', { x: 500, y: 450 })).isDone).toBe(true);
    expect(store.get('new-1' as ObjectId)).toMatchObject({
      type: 'connector',
      from: { kind: 'point', x: 300, y: 400 },
      to: { kind: 'point', x: 500, y: 450 },
      route: 'curved',
      endCap: 'none',
    });
    expect(record.commands).toBe(1);
    expect(record.selected).toEqual([['new-1']]);
    expect(record.previews.get('new-1' as ObjectId)).toBeUndefined();
  });

  it('turns the free end to the nearest 45 degrees with Shift', () => {
    const { store, context } = connectorToolContext(FREE_STYLE);
    const mode = new ConnectorMode(context);
    mode.onPointer(pointer('pointerDown', { x: 300, y: 400 }, true));
    mode.onPointer(pointer('pointerMove', { x: 400, y: 410 }, true));
    mode.onPointer(pointer('pointerUp', { x: 400, y: 410 }, true));
    const line = store.get('new-1' as ObjectId);
    expect(line?.type).toBe('connector');
    if (line?.type === 'connector') {
      expect(line.from).toEqual({ kind: 'point', x: 300, y: 400 });
      expect(line.to.kind).toBe('point');
      if (line.to.kind === 'point') {
        expect(line.to.y).toBeCloseTo(400);
        expect(line.to.x).toBeGreaterThan(400);
      }
    }
  });

  it('draws nothing on a click or a drag between two points on one object', () => {
    const { store, context, record } = connectorToolContext(FREE_STYLE);
    const mode = new ConnectorMode(context);
    mode.onPointer(pointer('pointerDown', { x: 300, y: 400 }));
    expect(mode.onPointer(pointer('pointerUp', { x: 300, y: 400 })).isDone).toBe(false);
    mode.onPointer(pointer('pointerDown', { x: 30, y: 10 }));
    mode.onPointer(pointer('pointerMove', { x: 80, y: 40 }));
    expect(mode.onPointer(pointer('pointerUp', { x: 80, y: 40 })).isDone).toBe(false);
    expect([...store.read().objects.keys()].filter((key) => key.startsWith('new-'))).toEqual([]);
    expect(record.commands).toBe(0);
  });
});
