import { describe, expect, it } from 'vitest';

import { LINE_CAPS } from '@canvas/schema';

import { covers, meshBounds } from './__fixtures__/mesh-coverage.js';
import {
  capLength,
  capLengthOn,
  capReach,
  capShaftInset,
  capShaftStyle,
  capShapeOf,
  writeCapShape,
} from './caps.js';
import { TriangleWriter } from './triangle-writer.js';

const TOLERANCE = 0.05;
const TIP = { x: 100, y: 0 };
/** Pointing out of the line along +x: the line arrives from the left. */
const OUTWARD = { x: 1, y: 0 };

/**
 * The mesh of one cap.
 *
 * @param cap - The cap.
 * @param width - The stroke width.
 * @returns Its triangles.
 */
function capMesh(cap: (typeof LINE_CAPS)[number], width: number): Float32Array {
  const writer = new TriangleWriter();
  const shape = capShapeOf(cap, TIP, OUTWARD, width);
  if (shape) writeCapShape(writer, shape, width, TOLERANCE);
  return writer.toFloat32Array();
}

describe('capLength', () => {
  it('grows with the stroke width', () => {
    expect(capLength(1)).toBeLessThan(capLength(2));
    expect(capLength(8) - capLength(4)).toBeCloseTo(capLength(4) - capLength(0), 9);
  });
});

describe('capLengthOn', () => {
  it('is the cap length, at most half the line', () => {
    expect(capLengthOn(2)).toBe(capLength(2));
    expect(capLengthOn(2, 1000)).toBe(capLength(2));
    expect(capLengthOn(2, 10)).toBe(5);
    expect(capShaftInset('triangle', 2, 10)).toBe(2.5);
  });
});

describe('capShapeOf', () => {
  it('has no shape for no cap', () => {
    expect(capShapeOf('none', TIP, OUTWARD, 2)).toBeUndefined();
  });

  it('draws an open arrow as two barbs stroked back from the tip', () => {
    const length = capLength(2);
    expect(capShapeOf('arrow', TIP, OUTWARD, 2)).toEqual({
      kind: 'stroke',
      points: [
        { x: 100 - length, y: length / 2 },
        { x: 100, y: 0 },
        { x: 100 - length, y: -length / 2 },
      ],
    });
  });

  it('fills a triangle whose point is the tip', () => {
    const length = capLength(4);
    expect(capShapeOf('triangle', TIP, OUTWARD, 4)).toEqual({
      kind: 'polygon',
      points: [
        { x: 100, y: 0 },
        { x: 100 - length, y: length / 2 },
        { x: 100 - length, y: -length / 2 },
      ],
    });
  });

  it('centres a circle and a diamond on the end point', () => {
    const circle = capShapeOf('circle', TIP, OUTWARD, 2);
    expect(circle).toMatchObject({ kind: 'disc', centre: TIP });
    const diamond = capShapeOf('diamond', TIP, OUTWARD, 2);
    expect(diamond?.kind).toBe('polygon');
    const xs = diamond?.kind === 'polygon' ? diamond.points.map(({ x }) => x) : [];
    expect(Math.max(...xs) - 100).toBeCloseTo(100 - Math.min(...xs), 9);
  });

  it('turns with the direction out of the line', () => {
    const shape = capShapeOf('triangle', { x: 0, y: 0 }, { x: 0, y: -1 }, 2);
    const length = capLength(2);
    // Pointing up: the base lies below the tip.
    expect(shape?.kind === 'polygon' && shape.points[1]?.y).toBeCloseTo(length, 9);
  });
});

describe('cap meshes', () => {
  it('fills the triangle between the tip and its base, and nothing past the tip', () => {
    const mesh = capMesh('triangle', 2);
    const length = capLength(2);
    expect(covers(mesh, 100 - length / 2, 0)).toBe(true);
    expect(covers(mesh, 100.5, 0)).toBe(false);
    expect(covers(mesh, 100 - length / 2, length / 2)).toBe(false);
  });

  it('strokes an open arrow, leaving its inside empty', () => {
    const mesh = capMesh('arrow', 2);
    const length = capLength(2);
    expect(covers(mesh, 100, 0)).toBe(true);
    expect(covers(mesh, 100 - length / 2, length / 4)).toBe(true);
    expect(covers(mesh, 100 - length / 2, 0)).toBe(false);
  });

  it('fills a disc for a circle and a rhombus for a diamond', () => {
    const disc = capMesh('circle', 2);
    const bounds = meshBounds(disc);
    expect(bounds.maxX - 100).toBeCloseTo(100 - bounds.minX, 6);
    expect(covers(disc, 100, 0)).toBe(true);
    const diamond = capMesh('diamond', 2);
    expect(covers(diamond, 100, 0)).toBe(true);
  });

  it('scales every cap with the stroke width', () => {
    for (const cap of LINE_CAPS) {
      if (cap === 'none') continue;
      const thin = meshBounds(capMesh(cap, 1));
      const thick = meshBounds(capMesh(cap, 12));
      expect(thick.maxY - thick.minY).toBeGreaterThan(thin.maxY - thin.minY);
    }
  });

  it('stays within its reach of the tip', () => {
    for (const width of [1, 6, 64]) {
      for (const cap of LINE_CAPS) {
        const mesh = capMesh(cap, width);
        const reach = capReach(cap, width);
        for (let at = 0; at + 1 < mesh.length; at += 2) {
          const distance = Math.hypot((mesh[at] ?? 0) - TIP.x, (mesh[at + 1] ?? 0) - TIP.y);
          expect(distance).toBeLessThanOrEqual(reach + 1e-4);
        }
      }
    }
  });
});

describe('the shaft under a cap', () => {
  it('stops a filled triangle’s shaft inside the triangle, butt-ended', () => {
    const inset = capShaftInset('triangle', 2);
    expect(inset).toBeGreaterThan(0);
    expect(inset).toBeLessThan(capLength(2));
    expect(capShaftStyle('triangle')).toBe('butt');
  });

  it('runs a plain or open-arrow shaft to the end point, rounded', () => {
    expect(capShaftInset('none', 2)).toBe(0);
    expect(capShaftInset('arrow', 2)).toBe(0);
    expect(capShaftStyle('none')).toBe('round');
    expect(capShaftStyle('arrow')).toBe('round');
  });

  it('ends a circle’s or diamond’s shaft at the end point, which the cap covers', () => {
    expect(capShaftInset('circle', 2)).toBe(0);
    expect(capShaftStyle('circle')).toBe('butt');
    expect(capShaftStyle('diamond')).toBe('butt');
  });
});
