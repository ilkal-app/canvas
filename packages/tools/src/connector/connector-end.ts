import type { ObjectId, Point, UnitPoint } from '@canvas/schema';

import { nearestObjectAnchor } from '../line/line-anchors.js';
import { lineEndAt, type LineEndContext } from '../line/line-end.js';
import type { SelectPointer } from '../select/select-input.js';
import type { SnapGuide } from '../snap/snap-guide.js';

/** Where a connector end goes for a pointer: attached to an object, or a free point. */
export type ConnectorToolEnd =
  | {
      /** Attached to an object. */
      readonly kind: 'object';
      /** The object. */
      readonly objectId: ObjectId;
      /**
       * Where on the object's select box, as fractions of its size, when the end landed on one of
       * its anchors; null attaches to the side nearest the other end.
       */
      readonly anchor: UnitPoint | null;
      /** The anchor the end landed on, or the pointer over the object, world units. */
      readonly point: Point;
    }
  | {
      /** A free point. */
      readonly kind: 'point';
      /** Where, world units. */
      readonly point: Point;
      /** The guides through the lines it snapped to, when it snapped to edges or centres. */
      readonly guides: readonly SnapGuide[];
    };

/** What a connector end attaches and snaps against, for one pointer input. */
export interface ConnectorEndContext extends LineEndContext {
  /**
   * The topmost object under a point that an end attaches to without an anchor.
   *
   * @param world - The point, world units.
   * @param zoom - The camera zoom.
   * @returns The object's id, or `undefined`.
   */
  readonly objectAt: (world: Point, zoom: number) => ObjectId | undefined;
}

/**
 * Where a connector end goes for a pointer: on the nearest
 * anchor (an object's centre or edge midpoint, `nearestObjectAnchor`) within 8 CSS px, attached
 * there; else, over an object (`objectAt`), attached to it with an automatic anchor (the side
 * nearest the other end, chosen whenever either end moves); else a free point, snapped as a line
 * end is (`lineEndAt`: edges, centres and the grid while snapping is on; Shift turns it to the
 * nearest 45° about the other end). Anchors are offered whatever the snapping preference, since
 * attaching is what the tool does; the snap modifier (Alt, Option on a Mac) suspends them, so an
 * end over an object attaches to it automatically. The excluded objects are never attached to.
 * Pure: reads the index and the document.
 *
 * @param pointer - The pointer, with its world point and modifiers.
 * @param fixed - The connector's other end, when there is one (not at the press).
 * @param context - The index, the document, the zoom, the preferences, the view and what lies
 *   under the pointer.
 * @returns The end.
 */
export function connectorEndAt(
  pointer: SelectPointer,
  fixed: Point | undefined,
  context: ConnectorEndContext,
): ConnectorToolEnd {
  const { world } = pointer;
  const { index, source, zoom, excludedIds } = context;
  const anchor =
    index && pointer.isSnapSuspended !== true
      ? nearestObjectAnchor(index, source, world, { zoom, excludedIds })
      : undefined;
  if (anchor) {
    return {
      kind: 'object',
      objectId: anchor.objectId,
      anchor: anchor.fraction,
      point: anchor.point,
    };
  }
  const target = context.objectAt(world, zoom);
  if (target !== undefined && !excludedIds.has(target)) {
    return { kind: 'object', objectId: target, anchor: null, point: world };
  }
  const free = lineEndAt(pointer, fixed, context);
  return { kind: 'point', point: free.point, guides: free.guides };
}
