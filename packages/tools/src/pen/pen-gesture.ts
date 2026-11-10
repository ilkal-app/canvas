import type { PathNetwork } from '@canvas/engine';
import type { Point, Vertex } from '@canvas/schema';

import { constrain45 } from './constrain-45.js';
import { continuationHandle, setHandle } from './network-handles.js';
import { hitSegment, nearestVertex } from './network-hit.js';
import {
  addVertex,
  connect,
  negated,
  otherEnd,
  pruneOrphans,
  segmentsAt,
  ZERO_HANDLE,
  type Mirror,
  type NetworkIdSource,
} from './network.js';
import { splitSegment } from './split-segment.js';

// The pen's press and drag (the prototype's `PenMode`, webgl-whiteboard
// `src/app/modes/penMode.ts`), as pure steps over a network: a click places a corner, a click-drag
// a smooth point whose incoming handle mirrors the drag (Alt breaks it, Shift keeps it on 45°
// steps); a press on a vertex connects the chain to it and ends the chain (closing a loop at its
// start) or, with no chain, starts one from it; a press on a segment inserts a vertex without
// moving the curve. The mode previews each step and writes the press's network once, on release.

/** The chain being drawn: the vertex the next segment starts from and its outgoing handle. */
export interface PenChain {
  /** The vertex, or `undefined` when no chain is active. */
  readonly vertexId: string | undefined;
  /** The next segment's handle at that vertex, local units; zero for a corner. */
  readonly outHandle: Point;
}

/** No chain. */
export const NO_CHAIN: PenChain = Object.freeze({ vertexId: undefined, outHandle: ZERO_HANDLE });

/** What every pen drag knows: the network after its press and the vertex it pulls. */
export interface PenDragBase {
  /** The network after the press, before any drag. */
  readonly pressed: PathNetwork;
  /** The vertex the press placed or landed on: the drag pulls its handles. */
  readonly vertexId: string;
  /** Where that vertex is, local units. */
  readonly origin: Point;
}

/**
 * A press being dragged: what a drag past the dead zone shapes. A `place` drag shapes a vertex the
 * press placed (its `mirror` follows the drag) or picked up to start a chain; a `join` drag
 * shapes the segment that connected the chain to an existing vertex, which ends the chain.
 */
export type PenDrag =
  | (PenDragBase & {
      /** The press placed a vertex, or picked one up to start a chain from it. */
      readonly kind: 'place';
      /** The segment arriving at the vertex from the chain (its `b` end), if any. */
      readonly segmentId: string | undefined;
      /** Whether the press placed the vertex. */
      readonly isNew: boolean;
    })
  | (PenDragBase & {
      /** The press connected the chain to an existing vertex. */
      readonly kind: 'join';
      /** The connecting segment; its `b` end is the vertex. */
      readonly segmentId: string;
    });

/** The network and the chain after a drag step or a Backspace. */
export interface PenStep {
  /** The network. */
  readonly network: PathNetwork;
  /** The chain. */
  readonly chain: PenChain;
}

/** What a press does: the network after it, the chain, and the drag it starts, if any. */
export interface PenPressStep {
  /** The network after the press. */
  readonly network: PathNetwork;
  /** The chain after the press. */
  readonly chain: PenChain;
  /** The drag the press starts, if its handles can be shaped. */
  readonly drag: PenDrag | undefined;
}

/** Hit tolerances of a press, local units (the CSS px tolerances over the zoom). */
export interface PenTolerances {
  /** For vertices. */
  readonly vertex: number;
  /** For segments. */
  readonly segment: number;
}

/**
 * The press on an existing vertex: connect the chain to it (smooth when it is an open smooth
 * end) and end the chain there, or start a chain from it.
 *
 * @param network - The network.
 * @param chain - The chain.
 * @param vertex - The vertex pressed.
 * @param newId - Makes new ids.
 * @returns The step.
 */
function pressOnVertex(
  network: PathNetwork,
  chain: PenChain,
  vertex: Vertex,
  newId: NetworkIdSource,
): PenPressStep {
  const { id: vertexId } = vertex;
  const base = { pressed: network, vertexId, origin: { x: vertex.x, y: vertex.y } };
  if (chain.vertexId === undefined) {
    const outHandle = continuationHandle(network, vertexId) ?? ZERO_HANDLE;
    const drag = { ...base, kind: 'place', segmentId: undefined, isNew: false } as const;
    return { network, chain: { vertexId, outHandle }, drag };
  }
  // Pressing the chain's own last vertex does nothing: end the chain with Enter or Escape.
  if (chain.vertexId === vertexId) return { network, chain, drag: undefined };
  const arriving = continuationHandle(network, vertexId) ?? ZERO_HANDLE;
  const joined = connect(network, chain.vertexId, vertexId, newId, chain.outHandle, arriving);
  // Already joined: nothing to add, and the chain ends.
  if (joined.id === null) return { network, chain: NO_CHAIN, drag: undefined };
  const drag = { ...base, pressed: joined.network, kind: 'join', segmentId: joined.id } as const;
  return { network: joined.network, chain, drag };
}

/**
 * The pen's press at a local point (see above): on a vertex, on a segment, else a new vertex
 * joined to the chain. `point` is already constrained to 45° from the chain's vertex when Shift
 * is held, and snapped when it places a new vertex.
 *
 * @param network - The network before the press.
 * @param chain - The chain.
 * @param point - The press, local units.
 * @param tolerances - The hit tolerances, local units.
 * @param newId - Makes new ids.
 * @returns The step.
 */
export function penPress(
  network: PathNetwork,
  chain: PenChain,
  point: Point,
  tolerances: PenTolerances,
  newId: NetworkIdSource,
): PenPressStep {
  const vertex = nearestVertex(network, point, tolerances.vertex);
  if (vertex !== undefined) return pressOnVertex(network, chain, vertex, newId);
  const segment = hitSegment(network, point, tolerances.segment);
  const split = segment && splitSegment(network, segment.segmentId, segment.t, newId);
  if (split) {
    if (chain.vertexId === undefined) return { network: split.network, chain, drag: undefined };
    const joined = connect(split.network, chain.vertexId, split.vertexId, newId, chain.outHandle);
    return { network: joined.network, chain: NO_CHAIN, drag: undefined };
  }
  const added = addVertex(network, point, newId);
  const from = chain.vertexId;
  const joined =
    from === undefined ? undefined : connect(added.network, from, added.id, newId, chain.outHandle);
  const pressed = joined?.network ?? added.network;
  const drag = {
    pressed,
    vertexId: added.id,
    origin: point,
    kind: 'place',
    segmentId: joined?.id ?? undefined,
    isNew: true,
  } as const;
  return { network: pressed, chain: { vertexId: added.id, outHandle: ZERO_HANDLE }, drag };
}

/**
 * The pen's drag past the dead zone: the pressed vertex's outgoing handle follows the pointer
 * and the arriving segment's handle mirrors it (Alt breaks the mirror: only the outgoing
 * handle follows and the vertex becomes a corner-type `none`). A drag that closes or joins onto
 * an existing vertex writes the arriving handle through `setHandle`, so the pair follows that
 * vertex's own mirror.
 *
 * @param drag - The press being dragged.
 * @param chain - The chain after the press.
 * @param point - The pointer, local units.
 * @param isShiftPressed - Whether Shift keeps the handle on 45° steps.
 * @param isAltPressed - Whether Alt breaks the mirror.
 * @returns The network and the chain after the drag step.
 */
export function penDrag(
  drag: PenDrag,
  chain: PenChain,
  point: Point,
  isShiftPressed: boolean,
  isAltPressed: boolean,
): PenStep {
  const { origin } = drag;
  const raw = { x: point.x - origin.x, y: point.y - origin.y };
  const outHandle = isShiftPressed ? constrain45(ZERO_HANDLE, raw) : raw;
  const arriving = negated(outHandle);
  const next = { vertexId: chain.vertexId, outHandle };
  if (drag.kind === 'join') {
    const shaped = setHandle(drag.pressed, drag.segmentId, 'b', arriving, isAltPressed);
    return { network: shaped, chain: next };
  }
  const segments =
    drag.segmentId !== undefined && !isAltPressed
      ? drag.pressed.segments.map((segment) =>
          segment.id === drag.segmentId ? { ...segment, hb: arriving } : segment,
        )
      : drag.pressed.segments;
  const mirror: Mirror = isAltPressed ? 'none' : 'both';
  const vertices = drag.isNew
    ? drag.pressed.vertices.map((candidate) =>
        candidate.id === drag.vertexId ? { ...candidate, mirror } : candidate,
      )
    : drag.pressed.vertices;
  return { network: { vertices, segments }, chain: next };
}

/**
 * Backspace while drawing: removes the chain's last vertex and its segment, and the chain steps
 * back to the previous vertex (removing the first vertex ends the chain). A chain started from a
 * junction (a vertex with more than one segment) is only ended: the junction stays. Vertices
 * left with no segment are dropped, except the one the chain steps back to.
 *
 * @param network - The network.
 * @param chain - The chain.
 * @returns The network and the chain after it; an empty network means nothing is left.
 */
export function penBackspace(network: PathNetwork, chain: PenChain): PenStep {
  const removed = chain.vertexId;
  if (removed === undefined) return { network, chain };
  const ends = segmentsAt(network, removed);
  if (ends.length > 1) return { network, chain: NO_CHAIN };
  const previous = ends[0] ? otherEnd(ends[0].segment, removed) : undefined;
  const remaining = pruneOrphans(
    {
      vertices: network.vertices.filter(({ id }) => id !== removed),
      segments: network.segments.filter(({ a, b }) => a !== removed && b !== removed),
    },
    previous,
  );
  return { network: remaining, chain: { vertexId: previous, outHandle: ZERO_HANDLE } };
}
