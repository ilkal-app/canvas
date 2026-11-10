import {
  applyTransform,
  buildChildIndex,
  invertTransform,
  compareSiblings,
  localBounds,
  placementTransform,
  type Board,
  type BoardObject,
  type BoundsCache,
  type ChildIndex,
  type ObjectId,
  type Point,
  type RigidTransform,
} from '@canvas/schema';

import type { NewObject } from '../commands/new-object-schema.js';

/**
 * How far a paste lands from the copied objects when the pointer is not on the canvas, and how
 * far a duplicate lands from its originals: world units, on both axes.
 */
export const PASTE_OFFSET = 16;

/** The fields `createObjects` generates, which a listed object leaves out. */
const GENERATED_FIELDS: ReadonlySet<string> = new Set(['z', 'createdBy', 'createdAt', 'updatedAt']);

/**
 * The objects of a board in the order `createObjects` stacks them: each parent before its
 * children, and siblings bottom first (`compareSiblings`), depth first from the root. Pure.
 *
 * @param board - The board.
 * @param children - Its child index; built from the board when absent.
 * @returns The objects reachable from the root.
 */
export function inStackingOrder(
  board: Board,
  children: ChildIndex = buildChildIndex(board),
): BoardObject[] {
  const ordered: BoardObject[] = [];
  const visit = (parentId: ObjectId | null): void => {
    const siblings = (children.get(parentId) ?? [])
      .flatMap((id) => board.objects.get(id) ?? [])
      .sort(compareSiblings);
    for (const object of siblings) {
      ordered.push(object);
      visit(object.id);
    }
  };
  visit(null);
  return ordered;
}

/**
 * The points a root object covers on the board: the corners of its bounds, or a connector's
 * free ends (a connector's own bounds are its origin).
 *
 * @param board - The board.
 * @param root - An object at the board's root.
 * @param children - The board's child index.
 * @param cache - Bounds measured on this board.
 * @returns The points, board coordinates.
 */
function extentOf(
  board: Board,
  root: BoardObject,
  children: ChildIndex,
  cache: BoundsCache,
): Point[] {
  const placement = placementTransform(root.x, root.y, root.rotation);
  if (root.type === 'connector') {
    return [root.from, root.to].flatMap((end) =>
      end.kind === 'point' ? [applyTransform(placement, end)] : [],
    );
  }
  const { x, y, width, height } = localBounds(board, root, children, cache);
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ].map((corner) => applyTransform(placement, corner));
}

/**
 * The centre of the axis-aligned box around the roots of a pasted board.
 *
 * @param board - The pasted board.
 * @param roots - Its root objects.
 * @param children - Its child index.
 * @returns The centre, board coordinates, or `undefined` when nothing has an extent.
 */
function centreOf(
  board: Board,
  roots: readonly BoardObject[],
  children: ChildIndex,
): Point | undefined {
  const cache: BoundsCache = new Map();
  const points = roots.flatMap((root) => extentOf(board, root, children, cache));
  if (points.length === 0) return undefined;
  // Running extremes: spreading thousands of points into Math.min would overflow the stack.
  let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const { x, y } of points) {
    [left, top] = [Math.min(left, x), Math.min(top, y)];
    [right, bottom] = [Math.max(right, x), Math.max(bottom, y)];
  }
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

/**
 * An object as `createObjects` lists it: its own id (local to the list) and fields, without the
 * stacking key and stamps the command generates.
 *
 * @param object - The object.
 * @param shift - Added to its position when it is a root.
 * @returns The listed object.
 */
function toListed(object: BoardObject, shift: Point): NewObject {
  const fields = Object.fromEntries(
    Object.entries(object).filter(([key]) => !GENERATED_FIELDS.has(key)),
  );
  const isRoot = object.parentId === null;
  const listed = isRoot ? { ...fields, x: object.x + shift.x, y: object.y + shift.y } : fields;
  // The object passed the schema, so without the generated fields it is what createObjects lists.
  return listed as NewObject;
}

/**
 * Plans a paste: the objects of a copied
 * board (`copySelection`, or `importBoard` of a clipboard's objects flavour) as `createObjects`
 * lists them, parents before children and siblings bottom first, with their ids local to the
 * list. With a point, the box around the copied roots is centred on it (a paste at the pointer);
 * without one, the roots move by {@link PASTE_OFFSET} on both axes from where they were copied (a
 * duplicate, or a paste while the pointer is off the canvas). Comments are left out: a pin
 * belongs to a thread outside the document. Pure.
 *
 * @param board - The copied board: every object's parent on it, the roots in board coordinates.
 * @param at - Where to centre the paste, board coordinates; `undefined` to offset it.
 * @param offset - How far the roots move when `at` is `undefined` (an agent's duplicate);
 *   {@link PASTE_OFFSET} on both axes by default.
 * @returns The objects to create, for `createObjects` with the target parent.
 */
export function planPaste(
  board: Board,
  at: Point | undefined,
  offset: Point = { x: PASTE_OFFSET, y: PASTE_OFFSET },
): NewObject[] {
  const children = buildChildIndex(board);
  const ordered = inStackingOrder(board, children).filter(({ type }) => type !== 'comment');
  const roots = ordered.filter((object) => object.parentId === null);
  const centre = at === undefined ? undefined : centreOf(board, roots, children);
  const shift =
    at === undefined || centre === undefined ? offset : { x: at.x - centre.x, y: at.y - centre.y };
  return ordered.map((object) => toListed(object, shift));
}

/**
 * Re-expresses a planned paste's top-level objects in a parent's frame, so they can go into that
 * parent (a duplicate stays in its originals' group or frame) and still land where the plan put
 * them on the board. Children are relative to their listed parents and stay as they are. Pure.
 *
 * @param objects - The planned objects (`planPaste`), top-level ones in board coordinates.
 * @param parentToBoard - The parent's own frame to the board (`objectToBoardTransform`).
 * @returns The objects, top-level ones in the parent's frame.
 */
export function inParentFrame(
  objects: readonly NewObject[],
  parentToBoard: RigidTransform,
): NewObject[] {
  const boardToParent = invertTransform(parentToBoard);
  const turn = Math.atan2(parentToBoard.sin, parentToBoard.cos);
  return objects.map((object) =>
    object.parentId !== null
      ? object
      : {
          ...object,
          ...applyTransform(boardToParent, { x: object.x, y: object.y }),
          rotation: object.rotation - turn,
        },
  );
}
