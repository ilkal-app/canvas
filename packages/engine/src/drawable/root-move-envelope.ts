import { freehandPointsOf, type BoardObject, type ObjectId } from '@canvas/schema';

import type { RootMovePlacement } from '../scene/root-move-placement.js';
import type { SceneChangeSet } from '../scene/scene-source.js';

import { DRAWABLE_EXTENT } from './drawable-extent.js';

/** A deliberately small interior: two rotated local components plus origin stay below 3E/8. */
const INTERIOR = DRAWABLE_EXTENT / 8;

/** The interior a retained move's placements must keep within, world units. */
export const ROOT_MOVE_INTERIOR = INTERIOR;

/**
 * Matches a live host snapshot to the exact update membership, before any shortcut.
 *
 * @param changes - The change being judged.
 * @param placement - Current host placement.
 * @returns Whether this snapshot describes precisely these updates.
 */
export function matchesRootPlacement(
  changes: SceneChangeSet,
  placement: RootMovePlacement,
): boolean {
  return (
    changes.created.length === 0 &&
    changes.deleted.length === 0 &&
    placement.ids.length === changes.updated.length &&
    placement.objects.length === placement.ids.length &&
    placement.positions.length === placement.ids.length * 2 &&
    matchesMembership(changes.updated, placement)
  );
}

/** Each membership array whose ids were checked against these objects. */
const checkedMemberships = new WeakMap<readonly ObjectId[], readonly BoardObject[]>();

/**
 * Whether the update lists exactly the placement's membership, in order. The mirror lists its
 * own membership array as every update of a session, so after the first check that array and
 * its objects are known to match: later frames compare identities, not every member.
 *
 * @param updated - The update's ids.
 * @param placement - The placement.
 * @returns Whether they match.
 */
function matchesMembership(updated: readonly ObjectId[], placement: RootMovePlacement): boolean {
  const { ids, objects } = placement;
  if (updated === ids && checkedMemberships.get(ids) === objects) return true;
  const isMatch = updated.every((id, index) => id === ids[index] && id === objects[index]?.id);
  if (isMatch && updated === ids) checkedMemberships.set(ids, objects);
  return isMatch;
}

/**
 * Keeps only a successful session's immutable geometry proof; never caches decoded positions.
 * The gate invalidates it on every ordinary batch, membership change or refused placement.
 */
export class RootMoveEnvelope {
  private readonly ids: RootMovePlacement['ids'];
  private readonly objects: RootMovePlacement['objects'];

  constructor(placement: RootMovePlacement) {
    this.ids = placement.ids;
    this.objects = placement.objects;
  }

  /**
   * Makes a conservative proof after the gate has checked all fields and actual root hierarchy.
   *
   * @param placement - The successful current session.
   * @returns A proof when every local point is deep inside the extent.
   */
  static create(placement: RootMovePlacement): RootMoveEnvelope | undefined {
    return placement.objects.every(hasInteriorGeometry)
      ? new RootMoveEnvelope(placement)
      : undefined;
  }

  /**
   * Checks current coordinates without asking the source to materialize any objects.
   *
   * @param placement - The current live snapshot.
   * @returns Whether all exact rotated coordinates are safely within the extent.
   */
  accepts(placement: RootMovePlacement): boolean {
    if (placement.ids !== this.ids || placement.objects !== this.objects) return false;
    const { positions, delta } = placement;
    if (delta === undefined) {
      return positions.every((value) => Number.isFinite(value) && Math.abs(value) <= INTERIOR);
    }
    // A translation: the begin positions' extremes, once per array, moved by the delta.
    const extent = extentOf(positions);
    return (
      extent !== undefined &&
      Math.abs(extent.minX + delta[0]) <= INTERIOR &&
      Math.abs(extent.maxX + delta[0]) <= INTERIOR &&
      Math.abs(extent.minY + delta[1]) <= INTERIOR &&
      Math.abs(extent.maxY + delta[1]) <= INTERIOR
    );
  }
}

/**
 * Bounds the same local points the exact gate checks. The large margin absorbs floating-point
 * rounding; no transformed bounds, geometry, or refusal reasons are approximated or replaced.
 *
 * @param object - Immutable, already validated session base.
 * @returns Whether both components of every local point are at most E/8 in magnitude.
 */
function hasInteriorGeometry(object: BoardObject): boolean {
  const point = (x: number, y: number): boolean =>
    Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= INTERIOR && Math.abs(y) <= INTERIOR;
  switch (object.type) {
    case 'frame':
    case 'group':
      return false;
    case 'connector':
    case 'comment':
      return true;
    case 'line':
      return object.points.every(({ x, y }) => point(x, y));
    case 'path': {
      const vertices = new Map(object.vertices.map((vertex) => [vertex.id, vertex]));
      return (
        object.vertices.every(({ x, y }) => point(x, y)) &&
        object.segments.every(({ a, b, ha, hb }) => {
          const start = vertices.get(a);
          const end = vertices.get(b);
          return (
            (!start || point(start.x + ha.x, start.y + ha.y)) &&
            (!end || point(end.x + hb.x, end.y + hb.y))
          );
        })
      );
    }
    case 'freehand':
      return freehandPointsOf(object.points).every(({ x, y }) => point(x, y));
    default:
      return point(object.width, object.height);
  }
}

/** The extremes of each begin-positions array a translation was checked from. */
const extents = new WeakMap<
  Float64Array,
  { minX: number; minY: number; maxX: number; maxY: number } | undefined
>();

/**
 * The extremes of `x, y` pairs, once per array.
 *
 * @param positions - The pairs.
 * @returns Their extremes, or undefined when one is not finite.
 */
function extentOf(
  positions: Float64Array,
): { minX: number; minY: number; maxX: number; maxY: number } | undefined {
  if (extents.has(positions)) return extents.get(positions);
  let extent: { minX: number; minY: number; maxX: number; maxY: number } | undefined = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
  for (let index = 0; index + 1 < positions.length; index += 2) {
    const x = positions[index] ?? Number.NaN;
    const y = positions[index + 1] ?? Number.NaN;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      extent = undefined;
      break;
    }
    extent.minX = Math.min(extent.minX, x);
    extent.maxX = Math.max(extent.maxX, x);
    extent.minY = Math.min(extent.minY, y);
    extent.maxY = Math.max(extent.maxY, y);
  }
  extents.set(positions, extent);
  return extent;
}
