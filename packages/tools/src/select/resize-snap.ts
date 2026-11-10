import type { WorldBounds } from '@canvas/engine';
import type { Point } from '@canvas/schema';

import { guidesOf, snapBox, type SnapEdge, type SnapEdges } from '../snap/snap-box.js';

import {
  snappedGapsOf,
  type DragSnapContext,
  type ResizeIntent,
  type SnappedDrag,
} from './drag-snap.js';
import type { ResizeHandle } from './handle-layout.js';
import {
  boxPointToWorld,
  normalizeAngle,
  worldBoundsOfBox,
  worldPointToBox,
  type OrientedBox,
} from './oriented-box.js';
import { resizeFrame } from './resize-frame.js';

/** The lines of the frame each handle drags, in the frame's own axes. */
const RESIZED_EDGES: Readonly<Record<ResizeHandle, SnapEdges>> = {
  nw: { x: ['min'], y: ['min'] },
  n: { x: [], y: ['min'] },
  ne: { x: ['max'], y: ['min'] },
  e: { x: ['max'], y: [] },
  se: { x: ['max'], y: ['max'] },
  s: { x: [], y: ['max'] },
  sw: { x: ['min'], y: ['max'] },
  w: { x: ['min'], y: [] },
};

/** How far from a quarter turn, radians, a frame may be turned and still resize with snapping. */
const QUARTER_TURN_EPSILON = 1e-9;

type Axis = 'x' | 'y';

/** Where one of the frame's own axes points in the world. */
interface AxisInWorld {
  /** The world axis it lies along. */
  readonly axis: Axis;
  /** Whether it points the world axis's negative way. */
  readonly isReversed: boolean;
}

/** The frame's own x and y axes in the world, for each quarter turn (clockwise on screen). */
const QUARTER_TURN_AXES: readonly (readonly [AxisInWorld, AxisInWorld])[] = [
  [
    { axis: 'x', isReversed: false },
    { axis: 'y', isReversed: false },
  ],
  [
    { axis: 'y', isReversed: false },
    { axis: 'x', isReversed: true },
  ],
  [
    { axis: 'x', isReversed: true },
    { axis: 'y', isReversed: true },
  ],
  [
    { axis: 'y', isReversed: true },
    { axis: 'x', isReversed: false },
  ],
];

/**
 * The frame's own axes in the world when it is at a quarter turn (0°, 90°, 180° or 270°), so
 * its edges lie along the world's axes.
 *
 * @param rotation - The frame's rotation, radians.
 * @returns Its x and y axes in the world, or undefined for any other turn.
 */
function axesAtQuarterTurn(rotation: number): readonly [AxisInWorld, AxisInWorld] | undefined {
  const quarters = normalizeAngle(rotation) / (Math.PI / 2);
  const nearest = Math.round(quarters);
  if (Math.abs(quarters - nearest) * (Math.PI / 2) > QUARTER_TURN_EPSILON) return undefined;
  return QUARTER_TURN_AXES[((nearest % 4) + 4) % 4];
}

function flipped(edge: SnapEdge): SnapEdge {
  if (edge === 'min') return 'max';
  return edge === 'max' ? 'min' : edge;
}

/**
 * The world lines a handle drags on a frame at a quarter turn: each of its own edges mapped onto
 * the world axis it lies along, low and high swapped where that axis points the other way.
 *
 * @param handle - The handle.
 * @param axes - The frame's axes in the world.
 * @returns The dragged lines, by world axis.
 */
function worldEdgesOf(handle: ResizeHandle, axes: readonly [AxisInWorld, AxisInWorld]): SnapEdges {
  const edges: Record<Axis, SnapEdge[]> = { x: [], y: [] };
  const own = RESIZED_EDGES[handle];
  const pairs = [
    [own.x, axes[0]],
    [own.y, axes[1]],
  ] as const;
  for (const [local, { axis, isReversed }] of pairs) {
    for (const edge of local) edges[axis].push(isReversed ? flipped(edge) : edge);
  }
  return edges;
}

/**
 * The size a proportional resize takes when the side along the frame's own x (or y) is given:
 * the other side follows the intent's aspect (a lone image's drawn aspect), or the frame's own.
 *
 * @param intent - The resize so far.
 * @param isOwnX - Whether the given side is along the frame's own x.
 * @param length - That side's new length, world units.
 * @returns The width and height, or undefined for a frame with no length along that side.
 */
function proportionalSizeOf(
  intent: ResizeIntent,
  isOwnX: boolean,
  length: number,
): { readonly width: number; readonly height: number } | undefined {
  const { from, aspect } = intent;
  if (aspect !== undefined) {
    return isOwnX
      ? { width: length, height: length / aspect }
      : { width: length * aspect, height: length };
  }
  const fromLength = isOwnX ? from.width : from.height;
  if (!(fromLength > 0)) return undefined;
  const scale = length / fromLength;
  return { width: from.width * scale, height: from.height * scale };
}

/**
 * The pointer displacement, world units, that resizes a frame proportionally to a size: the
 * dragged sides reach it in the frame's own axes, so `resizeFrame`'s aspect rule lands exactly
 * on it; an undragged axis keeps the pointer's own displacement.
 *
 * @param intent - The resize so far.
 * @param size - The size to reach, world units.
 * @param size.width - Its width.
 * @param size.height - Its height.
 * @returns The displacement, world units.
 */
function proportionalDelta(
  intent: ResizeIntent,
  size: { readonly width: number; readonly height: number },
): Point {
  const { from, handle } = intent;
  const axes = { ...from, x: 0, y: 0 };
  const own = worldPointToBox(axes, intent.delta);
  const edges = RESIZED_EDGES[handle];
  const grow = (before: number, after: number, dragged: readonly SnapEdge[], fallback: number) => {
    if (dragged.length === 0) return fallback;
    return dragged[0] === 'min' ? before - after : after - before;
  };
  const local = {
    x: grow(from.width, size.width, edges.x, own.x),
    y: grow(from.height, size.height, edges.y, own.y),
  };
  return boxPointToWorld(axes, local);
}

/**
 * The displacement that puts the dragged edges on the lines they snap to: each dragged edge
 * moves with the pointer along its world axis, so the offset joins the displacement; with Shift,
 * the axis needing the smaller correction leads and the other follows the aspect ratio.
 *
 * @param intent - The resize so far.
 * @param axes - The frame's axes in the world (it is at a quarter turn).
 * @param box - The resized frame's bounds before snapping.
 * @param candidates - The candidates.
 * @param context - The threshold and the grid.
 * @returns The snapped displacement, world units.
 */
function snappedResizeDelta(
  intent: ResizeIntent,
  axes: readonly [AxisInWorld, AxisInWorld],
  box: WorldBounds,
  candidates: readonly WorldBounds[],
  context: DragSnapContext,
): Point {
  const edges = worldEdgesOf(intent.handle, axes);
  const snapOn = (only: SnapEdges): Point =>
    snapBox(box, candidates, context.thresholdWorld, context.grid, only).delta;
  if (!intent.isProportional) {
    const { x, y } = snapOn(edges);
    return { x: intent.delta.x + x, y: intent.delta.y + y };
  }
  const { x } = snapOn({ x: edges.x, y: [] });
  const { y } = snapOn({ x: [], y: edges.y });
  if (x === 0 && y === 0) return intent.delta;
  const lead: Axis = x !== 0 && (y === 0 || Math.abs(x) <= Math.abs(y)) ? 'x' : 'y';
  const offset = lead === 'x' ? x : y;
  const growth = edges[lead][0] === 'min' ? -offset : offset;
  // The world axis the lead lies along is the frame's own x at 0° and 180°, its y otherwise.
  const isOwnX = axes[0].axis === lead;
  const size = isOwnX ? intent.to.width : intent.to.height;
  const target = proportionalSizeOf(intent, isOwnX, size + growth);
  return target === undefined ? intent.delta : proportionalDelta(intent, target);
}

/**
 * Snaps a resize: the edges the handle drags snap to nearby objects'
 * edges and centres, or the grid, while the anchored edges stay where they are; with Shift the
 * frame keeps its aspect ratio, led by the dragged edge nearer a line. The frame is resized
 * again from the snapped displacement (`resizeFrame`), so the command the gesture commits is the
 * snapped one, and the guides are the lines the resized frame's dragged edges lie on. A frame at
 * a quarter turn (90°, 180°, 270°) has its edges on the world's axes too, so it snaps like an
 * upright one; a frame at any other turn resizes without snapping (accepted for now). Pure.
 *
 * @param intent - The resize so far.
 * @param context - The candidates, the threshold and the grid.
 * @returns The snapped resize, its guides and, when it snapped to an object, its gap runs.
 */
export function snapResize(
  intent: ResizeIntent,
  context: DragSnapContext,
): SnappedDrag<ResizeIntent> {
  const axes = axesAtQuarterTurn(intent.from.rotation);
  if (axes === undefined) return { intent, guides: [] };
  const box = worldBoundsOfBox(intent.to);
  const candidates = context.candidatesNear(box);
  const delta = snappedResizeDelta(intent, axes, box, candidates, context);
  const to: OrientedBox = resizeFrame(
    intent.from,
    intent.handle,
    delta,
    intent.isProportional,
    intent.aspect,
  );
  const landed = worldBoundsOfBox(to);
  const guides = guidesOf(landed, candidates, worldEdgesOf(intent.handle, axes));
  return {
    intent: { ...intent, delta, to },
    guides,
    gaps: snappedGapsOf(landed, candidates, guides),
  };
}
