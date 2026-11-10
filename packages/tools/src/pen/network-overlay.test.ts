import { describe, expect, it } from 'vitest';

import { HANDLE_FILL, SELECTION_COLOR } from '../select/overlay-rects.js';

import { testPath } from './__fixtures__/pen-mode-context.js';
import { networkOverlayRects, toWorld } from './network-overlay.js';

const FRAME = { cos: 1, sin: 0, x: 100, y: 100 };

/** The fixture path's two straight segments: one skeleton line each. */
const SKELETON = 2;

describe('networkOverlayRects', () => {
  it('draws every segment as a 1 px line under the vertices, at any zoom', () => {
    const rects = networkOverlayRects({
      network: testPath({ stroke: null }),
      frame: FRAME,
      zoom: 2,
      selected: new Set(),
    });
    expect(rects.slice(0, SKELETON)).toEqual([
      { box: { x: 100, y: 99.75, width: 100, height: 0.5, rotation: 0 }, color: SELECTION_COLOR },
      { box: { x: 200, y: 99.75, width: 100, height: 0.5, rotation: 0 }, color: SELECTION_COLOR },
    ]);
  });

  it('draws the segment under the pointer 2 px wide, and skips a segment with a missing end', () => {
    const path = testPath();
    const dangling = { id: 'x', a: 'v1', b: 'no', ha: { x: 0, y: 0 }, hb: { x: 0, y: 0 } };
    const rects = networkOverlayRects({
      network: { ...path, segments: [...path.segments, dangling] },
      frame: FRAME,
      zoom: 1,
      selected: new Set(),
      hoveredSegmentId: 's2',
    });
    expect(rects.slice(0, SKELETON).map(({ box }) => box.height)).toEqual([1, 2]);
    expect(rects).toHaveLength(SKELETON + 6);
  });

  it('draws each vertex as an 8 px square, white inside unless selected, at any zoom', () => {
    const rects = networkOverlayRects({
      network: testPath(),
      frame: FRAME,
      zoom: 2,
      selected: new Set(),
    }).slice(SKELETON);
    expect(rects).toHaveLength(6);
    expect(rects[0]).toEqual({
      box: { x: 98, y: 98, width: 4, height: 4, rotation: 0 },
      color: SELECTION_COLOR,
    });
    expect(rects[1]?.color).toEqual(HANDLE_FILL);
    expect(rects[1]?.box.width).toBe(3);
  });

  it('shows a selected vertex solid, with a line and a diamond per pulled-out handle', () => {
    const rects = networkOverlayRects({
      network: testPath(),
      frame: FRAME,
      zoom: 1,
      selected: new Set(['v2']),
    }).slice(SKELETON);
    // Two handles × (line, outer, inner) + three outer squares + two inner squares.
    expect(rects).toHaveLength(6 + 3 + 2);
    const [line] = rects;
    expect(line?.box).toMatchObject({ width: 30, height: 1 });
    expect(line?.box.rotation).toBeCloseTo(Math.PI, 9);
    expect(rects[1]?.box.rotation).toBeCloseTo(Math.PI / 4, 9);
  });

  it('draws the pending handle and the preview segment as 1 px lines', () => {
    const rects = networkOverlayRects({
      network: { vertices: [{ id: 'a', x: 0, y: 0, mirror: 'none' }], segments: [] },
      frame: FRAME,
      zoom: 1,
      selected: new Set(['a']),
      pendingHandle: { from: { x: 0, y: 0 }, handle: { x: 0, y: 20 } },
      previewSegment: [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 0 },
      ],
    });
    expect(rects[0]?.box).toEqual({ x: 100, y: 99.5, width: 50, height: 1, rotation: 0 });
    expect(rects[1]?.box).toMatchObject({ width: 20, height: 1 });
  });

  it('turns and places points with the path’s frame', () => {
    const turned = { cos: 0, sin: 1, x: 10, y: 20 };
    expect(toWorld(turned, { x: 5, y: 0 })).toEqual({ x: 10, y: 25 });
  });
});

describe('networkOverlayRects edge cases', () => {
  it('draws no handle for a selected vertex’s zero handle, and no line a float cannot hold', () => {
    const rects = networkOverlayRects({
      network: testPath(),
      frame: FRAME,
      zoom: 1,
      selected: new Set(['v1']),
    }).slice(SKELETON);
    // v1's only handle is zero: its solid square and the other two vertices' squares.
    expect(rects).toHaveLength(1 + 4);
    const far = networkOverlayRects({
      network: {
        vertices: [
          { id: 'a', x: 1e17, y: 0, mirror: 'none' },
          { id: 'b', x: 2e17, y: 0, mirror: 'none' },
        ],
        segments: [{ id: 's', a: 'a', b: 'b', ha: { x: 1, y: 0 }, hb: { x: 0, y: 0 } }],
      },
      frame: { cos: 1, sin: 0, x: 0, y: 0 },
      zoom: 1,
      selected: new Set(['a']),
    });
    // The handle's tip rounds onto its vertex: diamonds, and no line but the segment's own.
    expect(far.filter(({ box }) => box.height === 1)).toHaveLength(1);
  });
});
