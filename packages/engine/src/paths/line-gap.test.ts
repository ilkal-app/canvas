import { describe, expect, it } from 'vitest';

import { covers } from './__fixtures__/mesh-coverage.js';
import { splitAroundGap, type LineGap } from './line-gap.js';
import { buildLineMesh } from './line-mesh.js';
import { COVER_VERTEX_COUNT } from './path-mesh.js';

const gapAt = (x: number, y: number, halfWidth = 10, halfHeight = 5): LineGap => ({
  center: { x, y },
  halfWidth,
  halfHeight,
});

describe('splitAroundGap', () => {
  it('cuts a straight line at the box, each side keeping its own end', () => {
    expect(
      splitAroundGap(
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        gapAt(50, 0),
      ),
    ).toEqual({
      before: [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
      ],
      after: [
        { x: 60, y: 0 },
        { x: 100, y: 0 },
      ],
    });
  });

  it('leaves the box by its top and bottom on a vertical stretch, keeping the bends', () => {
    const route = [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
    ];
    expect(splitAroundGap(route, gapAt(0, 50))).toEqual({
      before: [
        { x: 0, y: 0 },
        { x: 0, y: 45 },
      ],
      after: [
        { x: 0, y: 55 },
        { x: 0, y: 100 },
        { x: 100, y: 100 },
      ],
    });
  });

  it('drops a side that ends inside the box, and draws a later pass through it', () => {
    const route = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
    ];
    expect(splitAroundGap(route, gapAt(5, 0)).before).toEqual([]);
    expect(splitAroundGap(route, gapAt(25, 0)).after).toEqual([]);
    const folding = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 2 },
      { x: 0, y: 2 },
    ];
    const { after } = splitAroundGap(folding, gapAt(50, 0, 10, 10));
    expect(after.at(-1)).toEqual({ x: 0, y: 2 });
  });

  it('does not split a line that misses the centre, or one with no segments', () => {
    const route = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(splitAroundGap(route, gapAt(50, 20))).toEqual({ before: route, after: [] });
    const point = [{ x: 0, y: 0 }];
    expect(splitAroundGap(point, gapAt(0, 0))).toEqual({ before: point, after: [] });
    const repeated = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 40, y: 0 },
    ];
    expect(splitAroundGap(repeated, gapAt(0, 0)).after[0]).toEqual({ x: 10, y: 0 });
  });

  it('draws only the side that has length when the gap takes a whole end', () => {
    const mesh = buildLineMesh({
      route: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      startCap: 'circle',
      endCap: 'arrow',
      gap: gapAt(0, 0),
      strokeWidth: 2,
      tolerance: 0.25,
    });
    const stroke = mesh.vertices.subarray(COVER_VERTEX_COUNT * 2);
    expect(covers(stroke, 5, 0)).toBe(false);
    expect(covers(stroke, 50, 0)).toBe(true);
  });
});
