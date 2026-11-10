import { describe, expect, it } from 'vitest';

import { cubicMidpoint, curvedConnectorCubic, curvePointOf, type ObjectId } from '@canvas/schema';

import { ADA } from '../select/__fixtures__/select-store.js';

import { AUTOMATIC, drag, input, setUp, STUB_FROM, STUB_TO } from './__fixtures__/route-handles.js';
import { CURVE_HANDLE_PX, ELBOW_HANDLE_LENGTH_PX } from './connector-route-overlay.js';

describe('ConnectorRouteHandles: edges', () => {
  it('drags a level piece up and down', () => {
    // From a's bottom (30, 60) to b's top (330, 200): stubs at y 84 and 176, the piece level.
    const { editor, connector } = setUp({
      from: { kind: 'object', objectId: 'a' as ObjectId, anchor: { x: 0.5, y: 1 } },
      to: { kind: 'object', objectId: 'b' as ObjectId, anchor: { x: 0.5, y: 0 } },
    });
    const handle = { x: 180, y: 130 };
    expect(editor.handleAt(handle, 1)).toBe('elbow');
    expect(editor.overlay()?.toolRects?.[0]?.box.width).toBe(ELBOW_HANDLE_LENGTH_PX);
    drag(editor, handle, { x: 0, y: 84 + (176 - 84) * 0.25 });
    expect(connector()?.elbowMiddle).toBeCloseTo(0.25, 12);
  });

  it('shows no handle on a connector the engine does not draw', () => {
    // Past the board's extent (a raw write the commands would refuse).
    expect(setUp({ x: 1e13 }).editor.overlay()).toBeUndefined();
  });

  it('writes nothing when the ends coincide or the piece is gone by the release', () => {
    const point = { kind: 'point', x: 100, y: 100 } as const;
    const curl = setUp({ route: 'curved', from: point, to: point });
    drag(curl.editor, { x: 100, y: 100 }, { x: 200, y: 200 });
    expect(curl.record.commands).toBe(0);
    const level = setUp();
    level.editor.press(input('pointerDown', AUTOMATIC), 1);
    // Box b level with a: the piece has no length any more.
    level.store.transact(ADA, (transaction) => {
      transaction.patchObject('b' as ObjectId, { y: 0 });
    });
    level.editor.follow(input('pointerMove', { x: 120, y: 30 }));
    level.editor.follow(input('pointerUp', { x: 120, y: 30 }));
    expect(level.record.commands).toBe(0);
  });

  it('resets only on a press with a time stamp after the click’s', () => {
    const { editor, connector } = setUp({ elbowMiddle: 0.25 });
    const handle = { x: STUB_FROM + (STUB_TO - STUB_FROM) * 0.25, y: 130 };
    const click = (down: number | null, up: number | null) => {
      editor.press(input('pointerDown', handle, down), 1);
      editor.follow(input('pointerUp', handle, up));
    };
    click(null, null);
    expect(editor.press(input('pointerDown', handle, null), 1)).toBe(true);
    expect(editor.isDragging).toBe(true);
    editor.follow(input('pointerUp', handle, 1000));
    // A press stamped before the click it follows is not a second press.
    editor.press(input('pointerDown', handle, 900), 1);
    editor.follow(input('pointerUp', handle, 2000));
    expect(connector()?.elbowMiddle).toBe(0.25);
    editor.press(input('pointerDown', handle, 2100), 1);
    expect(connector()).not.toHaveProperty('elbowMiddle');
  });
});

describe('ConnectorRouteHandles: a curve’s bend', () => {
  const ends = {
    from: { point: { x: 60, y: 30 }, normal: { x: 1, y: 0 } },
    to: { point: { x: 300, y: 230 }, normal: { x: -1, y: 0 } },
  };
  const automatic = cubicMidpoint(curvedConnectorCubic(ends.from, ends.to));

  it('puts a dot at the curve’s midpoint', () => {
    const { editor } = setUp({ route: 'curved' });
    expect(editor.handleAt(automatic, 1)).toBe('curve');
    const rects = editor.overlay()?.toolRects ?? [];
    // A disc of strips a third of a pixel tall, the border's 30, the inside's 24.
    expect(rects).toHaveLength(54);
    expect(Math.max(...rects.map(({ box }) => box.width))).toBeCloseTo(CURVE_HANDLE_PX, 1);
    // Every point a pixel inside the dot's edge, all round, is in a border strip, not an inside one.
    const covers = (from: number, to: number, point: { x: number; y: number }) =>
      rects
        .slice(from, to)
        .some(
          ({ box }) =>
            point.x >= box.x &&
            point.x <= box.x + box.width &&
            point.y >= box.y &&
            point.y <= box.y + box.height,
        );
    for (let step = 0; step < 24; step += 1) {
      const angle = (step * Math.PI) / 12;
      const ring = {
        x: automatic.x + 4.5 * Math.cos(angle),
        y: automatic.y + 4.5 * Math.sin(angle),
      };
      expect(covers(0, 30, ring)).toBe(true);
      expect(covers(30, 54, ring)).toBe(false);
    }
  });

  it('bends the curve through the point it is dragged to', () => {
    const { editor, connector } = setUp({ route: 'curved' });
    const target = { x: 120, y: 160 };
    drag(editor, automatic, target);
    const stored = connector()?.curvePoint;
    const expected = curvePointOf(ends.from.point, ends.to.point, target);
    expect(stored?.x).toBeCloseTo(expected?.x ?? Number.NaN, 12);
    expect(stored?.y).toBeCloseTo(expected?.y ?? Number.NaN, 12);
    expect(editor.handleAt(target, 1)).toBe('curve');
  });

  it('snaps onto the line between the ends: straight between free ends', () => {
    const free = setUp({
      route: 'curved',
      from: { kind: 'point', x: 0, y: 0 },
      to: { kind: 'point', x: 400, y: 0 },
    });
    drag(free.editor, { x: 200, y: 0 }, { x: 260, y: 60 });
    expect(free.connector()?.curvePoint?.y).toBeCloseTo(60 / 400, 12);
    drag(free.editor, { x: 260, y: 60 }, { x: 100, y: 5 });
    expect(free.connector()?.curvePoint).toEqual({ x: 0.25, y: 0 });
  });

  it('keeps a far drag within the schema’s reach', () => {
    const { editor, connector } = setUp({ route: 'curved' });
    drag(editor, automatic, { x: 180, y: -100_000 });
    expect(connector()?.curvePoint?.y).toBe(-10);
  });

  it('snaps back to the automatic curve and removes the field there', () => {
    const { editor, connector } = setUp({ route: 'curved', curvePoint: { x: 0.5, y: 0.5 } });
    const bent = cubicMidpoint(curvedConnectorCubic(ends.from, ends.to, { x: 0.5, y: 0.5 }));
    drag(editor, bent, { x: automatic.x + 3, y: automatic.y - 3 });
    expect(connector()).not.toHaveProperty('curvePoint');
  });
});
