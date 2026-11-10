import {
  placeObjectsCommand,
  runCommand,
  type CommandEnvironment,
  type CommandError,
  type DocumentStore,
  type TransactionOrigin,
} from '@canvas/document';
import type { AutoLayout, BoardObject, ObjectId, Point } from '@canvas/schema';

import { boxCentreOf, boxPointToWorld, worldPointToBox, type OrientedBox } from './oriented-box.js';
import { orientedBoxOf, type SelectionSource } from './selection-geometry.js';

// Reordering a live auto-layout's children by drag: a box moved within a frame or
// main that stacks its children, or dropped into one, takes the slot its centre is in along the
// stack, not the place the pointer left it, which the relayout would undo. The slot is a sibling
// to go directly below in the stacking order (children stack bottom first), or
// none for the end of the stack.

/** The object types an auto-layout container stacks: the boxes. */
const STACKED_TYPES: ReadonlySet<BoardObject['type']> = new Set([
  'text',
  'sticky',
  'image',
  'video',
  'shape',
  'frame',
  'component',
  'instance',
]);

/** Where a dragged box goes in a stack, and the line that shows it. */
export interface StackSlot {
  /** The auto-layout container. */
  readonly containerId: ObjectId;
  /** The child to go directly below in the stacking order; undefined for the end of the stack. */
  readonly belowId: ObjectId | undefined;
  /**
   * Where the slot is: a line across the stack, a box of no width (a row) or no height (a
   * column) in the container's frame, world units; the overlay gives it a screen thickness.
   */
  readonly line: OrientedBox;
}

/**
 * A container's auto-layout, when it is a frame or main that has one.
 *
 * @param object - The container.
 * @returns Its auto-layout, or undefined.
 */
export function stackLayoutOf(object: BoardObject | undefined): AutoLayout | undefined {
  return object?.type === 'frame' || object?.type === 'component' ? object.autoLayout : undefined;
}

/**
 * Whether an object takes part in its parent's stack: a box.
 *
 * @param object - The object.
 * @returns True for a box.
 */
export function isStackedType(object: BoardObject): boolean {
  return STACKED_TYPES.has(object.type);
}

/**
 * Stacking order, bottom first: by `z`, ties by id (as `sortedSiblings` orders a parent's
 * children). Ids are unique, so it never returns 0 for two objects.
 *
 * @param a - One object.
 * @param a.z - Its stacking key.
 * @param a.id - Its id.
 * @param b - Another.
 * @param b.z - Its stacking key.
 * @param b.id - Its id.
 * @returns Negative when `a` stacks below `b`, else positive.
 */
function byStackingOrder(
  a: { readonly z: string; readonly id: string },
  b: { readonly z: string; readonly id: string },
): number {
  if (a.z !== b.z) return a.z < b.z ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

/**
 * The slot a dragged box's centre is in, in a container's stack: before the first other stacked
 * child whose centre lies past it along the stack's axis, in the container's own frame, or at
 * the end. The children are taken in stacking order (by `z`, ties by id), leaving out the moved
 * objects. Pure: reads the document.
 *
 * @param containerId - The auto-layout container.
 * @param movedIds - The objects being dragged.
 * @param point - The dragged box's centre, world units.
 * @param document - The document.
 * @returns The slot, or undefined when the container has no auto-layout or no box.
 */
export function stackSlotOf(
  containerId: ObjectId,
  movedIds: ReadonlySet<ObjectId>,
  point: Point,
  document: SelectionSource,
): StackSlot | undefined {
  const container = document.get(containerId);
  const layout = stackLayoutOf(container);
  const frame = orientedBoxOf(containerId, document);
  if (layout === undefined || frame === undefined) return undefined;
  const isRow = layout.direction === 'row';
  const along = (local: Point) => (isRow ? local.x : local.y);
  const siblings = [...document.childrenOf(containerId)]
    .flatMap((id) => {
      const object = document.get(id);
      return object === undefined || movedIds.has(id) || !isStackedType(object) ? [] : [object];
    })
    .sort(byStackingOrder)
    .flatMap((object) => {
      const box = orientedBoxOf(object.id, document);
      if (box === undefined) return [];
      const corners = [
        { x: box.x, y: box.y },
        boxPointToWorld(box, { x: box.width, y: box.height }),
      ].map((corner) => along(worldPointToBox(frame, corner)));
      return [
        {
          id: object.id,
          centre: along(worldPointToBox(frame, boxCentreOf(box))),
          start: Math.min(...corners),
          end: Math.max(...corners),
        },
      ];
    });
  const at = along(worldPointToBox(frame, point));
  const index = siblings.findIndex((sibling) => sibling.centre > at);
  const next = index === -1 ? undefined : siblings[index];
  const previous = index === -1 ? siblings.at(-1) : siblings[index - 1];
  const main =
    next && previous
      ? (previous.end + next.start) / 2
      : (next?.start ?? previous?.end ?? (isRow ? layout.padding.left : layout.padding.top));
  const crossStart = isRow ? layout.padding.top : layout.padding.left;
  const crossEnd = isRow
    ? frame.height - layout.padding.bottom
    : frame.width - layout.padding.right;
  const cross = Math.max(0, crossEnd - crossStart);
  const origin = boxPointToWorld(
    frame,
    isRow ? { x: main, y: crossStart } : { x: crossStart, y: main },
  );
  return {
    containerId,
    belowId: next?.id,
    line: {
      ...origin,
      width: isRow ? 0 : cross,
      height: isRow ? cross : 0,
      rotation: frame.rotation,
    },
  };
}

/**
 * An insertion line thickened for the screen: a line of no width (or no height) widened to a
 * thickness about its own axis.
 *
 * @param line - The slot's line.
 * @param thickness - The thickness, world units.
 * @returns The box to draw.
 */
export function thickenedLine(line: OrientedBox, thickness: number): OrientedBox {
  const isVertical = line.width === 0;
  const origin = boxPointToWorld(
    line,
    isVertical ? { x: -thickness / 2, y: 0 } : { x: 0, y: -thickness / 2 },
  );
  return {
    ...origin,
    width: isVertical ? thickness : line.width,
    height: isVertical ? line.height : thickness,
    rotation: line.rotation,
  };
}

/**
 * Puts dragged boxes in a slot of an auto-layout's stack as one `placeObjects` command, so one
 * undo step: into the container, directly below the slot's child (or on top, at the end of the
 * stack), keeping their own stacking order; the command's relayout places them.
 *
 * @param store - The document.
 * @param origin - Who the change is attributed to.
 * @param environment - The command clock and id generator.
 * @param document - The document as the select tool reads it.
 * @param ids - The dragged boxes.
 * @param slot - The slot.
 * @returns The errors of a refused command, for the caller to report; empty when it ran.
 */
export function runStackDrop(
  store: DocumentStore,
  origin: TransactionOrigin,
  environment: CommandEnvironment,
  document: SelectionSource,
  ids: readonly ObjectId[],
  slot: StackSlot,
): readonly CommandError[] {
  const stacked = ids
    .map((id) => ({ id, z: document.get(id)?.z ?? '' }))
    .sort(byStackingOrder)
    .map(({ id }) => id);
  const input = {
    ids: stacked,
    parentId: slot.containerId,
    ...(slot.belowId === undefined ? {} : { belowId: slot.belowId }),
  };
  const outcome = runCommand(store, origin, placeObjectsCommand, input, environment);
  return outcome.status === 'applied' ? [] : outcome.errors;
}
