import type { WorldBounds } from '@canvas/engine';
import type { ObjectId, Point, UnitPoint } from '@canvas/schema';

import { boxPointToWorld, type OrientedBox } from '../select/oriented-box.js';
import { orientedBoxOf, type SelectionSource } from '../select/selection-geometry.js';
import type { SnapIndex } from '../snap/snap-candidates.js';

/**
 * How near an object's anchor a line end must come to land on it, CSS px, whatever the zoom.
 */
export const ANCHOR_SNAP_PX = 8;

/**
 * The most objects one anchor query measures exactly (their select boxes and anchors). Every
 * object the index proposes is measured up to this many, so the nearest anchor wins whatever the
 * objects' indexed boxes suggest; beyond it, in a pile of objects under the pointer, the ones
 * whose indexed boxes' anchors come nearest are kept. It bounds the work of a pointer move, as
 * `SNAP_CANDIDATES_PER_BAND` bounds a drag's snapping (`line-anchors.bench.ts`: about 0.14 ms to
 * measure 500 piled objects, so 256 stays well inside a move's budget).
 */
export const ANCHOR_CANDIDATES_CAP = 256;

/**
 * An object's anchors: the centre of its select box and the middle of
 * each edge, turned with the box, centre first, then top, right, bottom and left. Pure.
 *
 * @param box - The object's select box (`orientedBoxOf`), world units.
 * @returns The five anchors, world units.
 */
export function anchorsOfBox(box: OrientedBox): Point[] {
  const { width, height } = box;
  return [
    { x: width / 2, y: height / 2 },
    { x: width / 2, y: 0 },
    { x: width, y: height / 2 },
    { x: width / 2, y: height },
    { x: 0, y: height / 2 },
  ].map((local) => boxPointToWorld(box, local));
}

/**
 * How near a point comes to the anchors of an axis-aligned box (its centre and edge
 * midpoints): exact for an unturned object, but for a turned one the box's anchors are not the
 * object's (a square turned 45° has its corners there), so this only ranks a pile beyond
 * {@link ANCHOR_CANDIDATES_CAP}; allocation-free, since it runs once per object proposed.
 *
 * @param point - The point.
 * @param box - The object's indexed box.
 * @returns The least distance, world units.
 */
function distanceToBoxAnchors(point: Point, box: WorldBounds): number {
  const middleX = (box.minX + box.maxX) / 2;
  const middleY = (box.minY + box.maxY) / 2;
  return Math.min(
    Math.hypot(point.x - middleX, point.y - middleY),
    Math.hypot(point.x - middleX, point.y - box.minY),
    Math.hypot(point.x - box.maxX, point.y - middleY),
    Math.hypot(point.x - middleX, point.y - box.maxY),
    Math.hypot(point.x - box.minX, point.y - middleY),
  );
}

/** Where an anchor query looks. */
export interface AnchorQuery {
  /** The camera zoom, CSS px per world unit: the reach is {@link ANCHOR_SNAP_PX} on screen. */
  readonly zoom: number;
  /** Objects whose anchors are never offered: the line being drawn or edited. */
  readonly excludedIds: ReadonlySet<ObjectId>;
}

/**
 * Where each anchor of `anchorsOfBox` sits on its object's select box, as fractions of the box's
 * size, in the same order: centre, top, right, bottom, left. A connector end stores its anchor so
 * (`ConnectorEnd.anchor` of `@canvas/schema`).
 */
export const ANCHOR_FRACTIONS: readonly UnitPoint[] = Object.freeze([
  { x: 0.5, y: 0.5 },
  { x: 0.5, y: 0 },
  { x: 1, y: 0.5 },
  { x: 0.5, y: 1 },
  { x: 0, y: 0.5 },
]);

/** The anchor a point lands on, and whose it is. */
export interface ObjectAnchor {
  /** The object the anchor belongs to. */
  readonly objectId: ObjectId;
  /** The anchor, world units. */
  readonly point: Point;
  /** Where it sits on the object's select box, as fractions of its size (`ANCHOR_FRACTIONS`). */
  readonly fraction: UnitPoint;
}

/**
 * The anchor of an accepted object nearest a point within {@link ANCHOR_SNAP_PX}: one R-tree
 * query of the point grown by that reach, the {@link ANCHOR_CANDIDATES_CAP} whose indexed boxes'
 * anchors come nearest measured exactly (`nearestAnchor`, `nearestObjectAnchor`). Objects without a select box
 * (connectors, comments) offer none.
 *
 * @param index - The spatial index.
 * @param source - The document.
 * @param point - The point, world units.
 * @param query - The zoom and the objects left out.
 * @param isOffered - Whether an object offers its anchors.
 * @returns The anchor, or `undefined`.
 */
function nearestOfferedAnchor(
  index: SnapIndex,
  source: SelectionSource,
  point: Point,
  query: AnchorQuery,
  isOffered: (id: ObjectId) => boolean,
): ObjectAnchor | undefined {
  const reach = ANCHOR_SNAP_PX / query.zoom;
  const area = {
    minX: point.x - reach,
    minY: point.y - reach,
    maxX: point.x + reach,
    maxY: point.y + reach,
  };
  const proposed: { readonly id: ObjectId; readonly rank: number }[] = [];
  for (const id of index.searchRect(area)) {
    if (query.excludedIds.has(id) || !isOffered(id)) continue;
    const bounds = index.boundsOf?.(id);
    const rank = bounds ? distanceToBoxAnchors(point, bounds) : Number.POSITIVE_INFINITY;
    proposed.push({ id, rank });
  }
  if (proposed.length > ANCHOR_CANDIDATES_CAP) {
    // Compared, not subtracted: two unranked objects (infinite ranks) are equal, not NaN apart.
    proposed.sort((first, second) =>
      first.rank < second.rank ? -1 : Number(first.rank > second.rank),
    );
    proposed.length = ANCHOR_CANDIDATES_CAP;
  }
  let nearest: ObjectAnchor | undefined;
  let nearestDistance = reach;
  for (const { id } of proposed) {
    const box = orientedBoxOf(id, source);
    if (!box) continue;
    anchorsOfBox(box).forEach((anchor, at) => {
      const distance = Math.hypot(anchor.x - point.x, anchor.y - point.y);
      const fraction = ANCHOR_FRACTIONS[at];
      if (distance <= nearestDistance && fraction) {
        nearest = { objectId: id, point: anchor, fraction };
        nearestDistance = distance;
      }
    });
  }
  return nearest;
}

/**
 * The anchor a line end lands on: the nearest
 * centre or edge midpoint (`anchorsOfBox`) of an object within {@link ANCHOR_SNAP_PX} of the
 * point. One R-tree query of the point grown by that reach finds every object that can hold such
 * an anchor (an anchor lies on its object's box, so the box meets the query), so nothing scans
 * the board; the {@link ANCHOR_CANDIDATES_CAP} whose indexed boxes' anchors come nearest are then
 * measured exactly (a pile of objects under the pointer costs no more than the cap). Lines offer no anchors (their ends are free points, and a line attached to objects is
 * a connector), nor do the excluded objects. Snapping places the end on the anchor without
 * attaching it. Pure: reads the index and the document.
 *
 * @param index - The spatial index over the objects' world boxes.
 * @param source - The document.
 * @param point - The line end, world units.
 * @param query - The zoom and the objects left out.
 * @returns The anchor, world units, or `undefined` when none is within reach.
 */
export function nearestAnchor(
  index: SnapIndex,
  source: SelectionSource,
  point: Point,
  query: AnchorQuery,
): Point | undefined {
  const isOffered = (id: ObjectId) => source.get(id)?.type !== 'line';
  return nearestOfferedAnchor(index, source, point, query, isOffered)?.point;
}

/**
 * The anchor a connector end lands on: as {@link nearestAnchor},
 * but every object with a select box offers its anchors, lines included (a connector may attach
 * to a line; connectors and comments have no box, so a connector never attaches to them), and
 * the result names the object and where the anchor sits on its box, which the connector stores.
 * Pure: reads the index and the document.
 *
 * @param index - The spatial index over the objects' world boxes.
 * @param source - The document.
 * @param point - The connector end, world units.
 * @param query - The zoom and the objects left out.
 * @returns The anchor and its object, or `undefined` when none is within reach.
 */
export function nearestObjectAnchor(
  index: SnapIndex,
  source: SelectionSource,
  point: Point,
  query: AnchorQuery,
): ObjectAnchor | undefined {
  return nearestOfferedAnchor(index, source, point, query, () => true);
}
