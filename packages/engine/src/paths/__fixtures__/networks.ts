// Vector networks for the path tests, built the way the prototype's network tests build them
// (`webgl-whiteboard/src/vector/network.test.ts`, `build`): points become vertices `v0`, `v1`, …
// and index pairs become segments `s0`, `s1`, …, straight unless a handle pair is given.
import type { Point, Segment, Vertex } from '@canvas/schema';

import type { PathNetwork } from '../network-index.js';

/** A segment's handle offsets from its `a` and `b` ends. */
export type HandlePair = readonly [Point, Point];

/**
 * Builds a network from points and index pairs.
 *
 * @param points - The vertex positions, in order.
 * @param pairs - The segments, as `[from, to]` indices into `points`.
 * @param handles - Handle offsets per segment index; straight when absent.
 * @returns The network.
 */
export function buildNetwork(
  points: readonly (readonly [number, number])[],
  pairs: readonly (readonly [number, number])[],
  handles: Readonly<Record<number, HandlePair>> = {},
): PathNetwork & { vertices: Vertex[]; segments: Segment[] } {
  const vertices: Vertex[] = points.map(([x, y], index) => ({
    id: `v${String(index)}`,
    x,
    y,
    mirror: 'none',
  }));
  const segments: Segment[] = pairs.map(([from, to], index) => {
    const [ha, hb] = handles[index] ?? [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ];
    return { id: `s${String(index)}`, a: `v${String(from)}`, b: `v${String(to)}`, ha, hb };
  });
  return { vertices, segments };
}

/**
 * A closed polygon: its points joined in order and the last back to the first.
 *
 * @param points - The corners.
 * @param firstIndex - The index of the first vertex, so several polygons can share a network.
 * @returns The segments' index pairs.
 */
export function ringPairs(
  points: readonly unknown[],
  firstIndex = 0,
): (readonly [number, number])[] {
  return points.map((unused, index) => [
    firstIndex + index,
    firstIndex + ((index + 1) % points.length),
  ]);
}
