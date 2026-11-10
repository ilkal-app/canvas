import { describe, expect, it } from 'vitest';

import { finiteGeometry } from './finite-geometry.js';

describe('finiteGeometry', () => {
  it('keeps finite values as they are, past the board bound too', () => {
    const patch = {
      x: 1e300,
      y: -5,
      width: 2 ** 31,
      height: 0,
      points: [
        { x: 1e308, y: 1 },
        { x: 0, y: -1e308 },
      ],
    } as const;
    expect(finiteGeometry({ ...patch, points: [...patch.points] } as never)).toEqual({
      ...patch,
      points: [...patch.points],
    });
  });

  it('clamps what is not finite: an infinity to the largest number, NaN to 0, a size not below 0', () => {
    const result = finiteGeometry({
      x: Infinity,
      y: Number.NaN,
      width: -Infinity,
      height: Infinity,
      points: [{ x: -Infinity, y: 1 }],
    } as never) as unknown as Record<string, unknown>;
    expect(result).toMatchObject({
      x: Number.MAX_VALUE,
      y: 0,
      width: 0,
      height: Number.MAX_VALUE,
      points: [{ x: -Number.MAX_VALUE, y: 1 }],
    });
  });

  it('clamps vertices, segment handles and free connector ends, and leaves attached ends alone', () => {
    const result = finiteGeometry({
      vertices: [{ id: 'v', x: Infinity, y: 2, mirror: 'none' }],
      segments: [
        { id: 's', a: 'v', b: 'w', ha: { x: Number.NaN, y: 1 }, hb: { x: 1, y: Infinity } },
      ],
      from: { kind: 'point', x: Infinity, y: 0 },
      to: { kind: 'object', objectId: 'o', anchor: null },
    } as never) as unknown as Record<string, unknown>;
    expect(result).toEqual({
      vertices: [{ id: 'v', x: Number.MAX_VALUE, y: 2, mirror: 'none' }],
      segments: [
        { id: 's', a: 'v', b: 'w', ha: { x: 0, y: 1 }, hb: { x: 1, y: Number.MAX_VALUE } },
      ],
      from: { kind: 'point', x: Number.MAX_VALUE, y: 0 },
      to: { kind: 'object', objectId: 'o', anchor: null },
    });
  });
});
