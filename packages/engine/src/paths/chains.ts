import type { Point, Vertex } from '@canvas/schema';

import { cubicOf, flattenCubic, type Cubic } from './bezier.js';
import { edgesOf, type NetworkEdge, type NetworkIndex } from './network-index.js';

/** A maximal run of segments through vertices with exactly two segments. */
export interface StrokeChain {
  /** The run's curves, each oriented along the run, so one ends where the next starts. */
  readonly cubics: readonly Cubic[];
  /** Whether the run is a pure loop (every vertex of it has exactly two segments). */
  readonly isClosed: boolean;
}

/**
 * The segment of an edge as a cubic running from `from` towards the edge's other end.
 *
 * @param index - The network's index.
 * @param from - The vertex the walk leaves.
 * @param edge - The edge it leaves along.
 * @returns The oriented cubic.
 */
function orientedCubic(index: NetworkIndex, from: string, edge: NetworkEdge): Cubic {
  const cubic = cubicOf(index, edge.segment);
  return edge.segment.a === from ? cubic : [cubic[3], cubic[2], cubic[1], cubic[0]];
}

/**
 * The ids of a connected component's vertices, by depth-first search from one vertex.
 *
 * @param index - The network's index.
 * @param start - A vertex of the component.
 * @param seen - Vertices already assigned to a component; the component's are added.
 * @returns The component's vertex ids.
 */
function componentOf(index: NetworkIndex, start: string, seen: Set<string>): string[] {
  const component: string[] = [];
  const pending = [start];
  seen.add(start);
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    component.push(id);
    for (const { to } of edgesOf(index, id)) {
      if (seen.has(to)) continue;
      seen.add(to);
      pending.push(to);
    }
  }
  return component;
}

/**
 * The ordered vertex ids of every connected component in which each vertex has exactly two
 * segments: the regions a path fills (the prototype's `closedLoops`,
 * `webgl-whiteboard/src/vector/network.ts`). A component with a branch (a theta graph, a loop
 * with a tail) is stroked but never filled. Pure.
 *
 * @param index - The network's index.
 * @returns One list per loop, in walking order, starting at the loop's first vertex in the
 *   network's vertex order.
 */
export function closedLoops(index: NetworkIndex): string[][] {
  const seen = new Set<string>();
  const loops: string[][] = [];
  for (const { id } of index.network.vertices) {
    if (seen.has(id)) continue;
    const component = componentOf(index, id, seen);
    const isLoop =
      component.length >= 3 && component.every((member) => edgesOf(index, member).length === 2);
    if (!isLoop) continue;
    const loop = [id];
    let previous = id;
    let at = edgesOf(index, id)[0]?.to ?? id;
    while (at !== id) {
      loop.push(at);
      const next = edgesOf(index, at).find((edge) => edge.to !== previous)?.to ?? id;
      previous = at;
      at = next;
    }
    loops.push(loop);
  }
  return loops;
}

/**
 * The curves of a loop, each oriented along it, so that each ends where the next starts.
 *
 * @param index - The network's index.
 * @param loop - The loop's vertex ids in order, as {@link closedLoops} gives them.
 * @returns One cubic per segment of the loop.
 * @throws {RangeError} When two consecutive ids are not joined by a segment.
 */
export function loopCubics(index: NetworkIndex, loop: readonly string[]): Cubic[] {
  return loop.map((from, position) => {
    const to = loop[(position + 1) % loop.length];
    const edge = edgesOf(index, from).find((candidate) => candidate.to === to);
    if (!edge) throw new RangeError(`No segment joins "${from}" and "${String(to)}".`);
    return orientedCubic(index, from, edge);
  });
}

/**
 * Walks a chain from a vertex along an edge until it reaches an end, a branch or its start.
 *
 * @param index - The network's index.
 * @param start - The vertex the chain starts at.
 * @param first - The edge it leaves along.
 * @param visited - Segment ids already stroked; the chain's are added.
 * @returns The chain's oriented cubics.
 */
function walkChain(
  index: NetworkIndex,
  start: string,
  first: NetworkEdge,
  visited: Set<string>,
): Cubic[] {
  const cubics: Cubic[] = [];
  let from = start;
  let edge: NetworkEdge | undefined = first;
  while (edge && !visited.has(edge.segment.id)) {
    visited.add(edge.segment.id);
    cubics.push(orientedCubic(index, from, edge));
    const onward = edgesOf(index, edge.to);
    if (onward.length !== 2 || edge.to === start) break;
    const current: NetworkEdge = edge;
    from = edge.to;
    edge = onward.find((candidate) => candidate.segment.id !== current.segment.id);
  }
  return cubics;
}

/**
 * The network's segments as maximal chains through degree-2 vertices, so a stroke's joins
 * are continuous (the prototype's `strokeChains`): first every chain that starts at an end or a
 * branch, then the pure loops left over, which are closed. Every segment is in exactly one
 * chain. Pure.
 *
 * @param index - The network's index.
 * @returns The chains.
 */
export function strokeChains(index: NetworkIndex): StrokeChain[] {
  const visited = new Set<string>();
  const chains: StrokeChain[] = [];
  for (const { id } of index.network.vertices) {
    const edges = edgesOf(index, id);
    if (edges.length === 2) continue;
    for (const edge of edges) {
      if (!visited.has(edge.segment.id)) {
        chains.push({ cubics: walkChain(index, id, edge, visited), isClosed: false });
      }
    }
  }
  for (const { id } of index.network.vertices) {
    const edge = edgesOf(index, id).find((candidate) => !visited.has(candidate.segment.id));
    if (edge) chains.push({ cubics: walkChain(index, id, edge, visited), isClosed: true });
  }
  return chains;
}

/**
 * The vertices no segment touches: a pen path's first click, drawn as a dot when stroked.
 *
 * @param index - The network's index.
 * @returns The isolated vertices, in network order.
 */
export function isolatedVertices(index: NetworkIndex): Vertex[] {
  return index.network.vertices.filter(({ id }) => edgesOf(index, id).length === 0);
}

/**
 * Flattens a chain of joined cubics into one polyline; the point two cubics share appears once.
 *
 * @param cubics - The chain's cubics, each starting where the previous ends.
 * @param tolerance - The largest allowed distance from the curves, world units.
 * @returns The polyline; empty for no cubics.
 */
export function flattenChain(cubics: readonly Cubic[], tolerance: number): Point[] {
  const polyline: Point[] = [];
  for (const cubic of cubics) {
    const points = flattenCubic(cubic, tolerance);
    for (let at = polyline.length === 0 ? 0 : 1; at < points.length; at += 1) {
      const point = points[at];
      if (point) polyline.push(point);
    }
  }
  return polyline;
}

/** A chain flattened with its vertices flagged (`flattenChainCorners`). */
export interface FlattenedChain {
  /** The polyline, world units. */
  readonly points: Point[];
  /** Per point, whether it is one of the chain's vertices. */
  readonly corners: boolean[];
}

/**
 * Flattens a chain of joined cubics as {@link flattenChain} does, and flags the points that are
 * the chain's vertices: its ends and where one cubic meets the next. A stroke's join style
 * applies at those; the points inside a flattened curve join round.
 *
 * @param cubics - The chain's cubics, each starting where the previous ends.
 * @param tolerance - The largest allowed distance from the curves, world units.
 * @returns The polyline and a corner flag per point.
 */
export function flattenChainCorners(cubics: readonly Cubic[], tolerance: number): FlattenedChain {
  const points: Point[] = [];
  const corners: boolean[] = [];
  for (const cubic of cubics) {
    const flattened = flattenCubic(cubic, tolerance);
    // The point two cubics share appears once.
    const from = points.length === 0 ? 0 : 1;
    flattened.slice(from).forEach((point, index) => {
      points.push(point);
      corners.push(index + from === 0 || index + from === flattened.length - 1);
    });
  }
  return { points, corners };
}
