import type { Board } from '../board/board.js';
import { buildChildIndex, type ChildIndex } from '../board/child-index.js';
import { effectiveConstraints, type ConstraintMode } from '../fields/constraints.js';
import { mapObject, planGroupResize, type BoxSize } from '../geometry/group-resize.js';
import { localBounds } from '../geometry/local-bounds.js';
import type { ObjectId } from '../ids/object-id.js';
import type { BoardObject } from '../objects/board-object.js';

/** One axis after applying the parent's size change. */
interface AxisChange {
  readonly shift: number;
  readonly span: number;
}

/**
 * Applies the approved inset formulas; a zero parent span cannot define a stretch.
 *
 * @param mode - The child's constraint on this axis.
 * @param span - The child's original span, world units.
 * @param before - The parent's original span.
 * @param after - The parent's new span.
 * @param isRotated - Whether stretching would distort the child's rotation.
 * @returns Translation and new child span.
 */
function axisChange(
  mode: ConstraintMode,
  span: number,
  before: number,
  after: number,
  isRotated: boolean,
): AxisChange {
  const delta = before === 0 ? 0 : after - before;
  if (mode === 'end') return { shift: delta, span };
  if (mode === 'center' || (mode === 'stretch' && isRotated)) {
    return { shift: delta / 2, span };
  }
  return { shift: 0, span: mode === 'stretch' ? Math.max(0, span + delta) : span };
}

/** The immutable board and the accumulating resized descendants of one operation. */
interface ConstraintWalk {
  readonly board: Board;
  readonly children: ChildIndex;
  readonly result: Map<ObjectId, BoardObject>;
}

/**
 * Applies a group's existing proportional interior mapping and its own pin translation.
 *
 * @param walk - The board and result.
 * @param object - The group before resize.
 * @param x - Horizontal constraint result.
 * @param y - Vertical constraint result.
 */
function constrainGroup(
  walk: ConstraintWalk,
  object: BoardObject,
  x: AxisChange,
  y: AxisChange,
): void {
  const plan = planGroupResize(
    {
      get: (id) => walk.board.objects.get(id),
      childrenOf: (id) => walk.children.get(id) ?? [],
    },
    object,
    { to: { width: x.span, height: y.span } },
  );
  for (const child of plan.objects) {
    const source = walk.board.objects.get(child.id);
    let moved = child;
    if (child.id === object.id) moved = { ...child, x: child.x + x.shift, y: child.y + y.shift };
    if (moved.type === 'sticky' && source?.type === 'sticky') {
      moved = { ...moved, height: Math.max(source.height, moved.height) };
    }
    walk.result.set(child.id, moved);
  }
}

/**
 * Maps a non-boxed child's geometry around its local bounds, preserving stroke width.
 *
 * @param walk - The board and result.
 * @param object - The child.
 * @param x - Horizontal constraint result.
 * @param y - Vertical constraint result.
 */
function constrainGeometry(
  walk: ConstraintWalk,
  object: BoardObject,
  x: AxisChange,
  y: AxisChange,
): void {
  const bounds = localBounds(walk.board, object, walk.children);
  const scaleX = bounds.width === 0 ? 1 : x.span / bounds.width;
  const scaleY = bounds.height === 0 ? 1 : y.span / bounds.height;
  mapObject(
    object,
    {
      a: scaleX,
      b: 0,
      c: 0,
      d: scaleY,
      x: (object.x + bounds.x) * (1 - scaleX) + x.shift,
      y: (object.y + bounds.y) * (1 - scaleY) + y.shift,
    },
    walk.children,
    walk.board.objects,
    walk.result,
  );
}

/**
 * Visits one real child; nested sized containers use their children's own constraints.
 *
 * @param walk - The board and result.
 * @param object - The child before resize.
 * @param before - The parent's old size.
 * @param after - The parent's new size.
 */
function constrainChild(
  walk: ConstraintWalk,
  object: BoardObject,
  before: BoxSize,
  after: BoxSize,
): void {
  if (walk.result.has(object.id)) return;
  const bounds = localBounds(walk.board, object, walk.children);
  const modes = effectiveConstraints(object);
  const isRotated = object.rotation !== 0;
  const x = axisChange(modes.x, bounds.width, before.width, after.width, isRotated);
  const y = axisChange(modes.y, bounds.height, before.height, after.height, isRotated);
  if (object.type === 'group') {
    constrainGroup(walk, object, x, y);
    return;
  }
  if (!('width' in object)) {
    constrainGeometry(walk, object, x, y);
    return;
  }
  const width = object.type === 'text' && object.autoWidth ? object.width : x.span;
  const height = object.type === 'sticky' ? Math.max(object.height, y.span) : y.span;
  const moved = { ...object, x: object.x + x.shift, y: object.y + y.shift, width, height };
  walk.result.set(object.id, moved);
  for (const id of walk.children.get(object.id) ?? []) {
    const child = walk.board.objects.get(id);
    if (child !== undefined) constrainChild(walk, child, object, moved);
  }
}

/**
 * Resolves pin/stretch constraints for all real descendants of a sized container. Objects
 * remain in their parent's coordinate frame; source objects and styles are never mutated.
 * Instance references are expanded separately by the resolver, using the resulting box size.
 *
 * @param board - The board before the resize.
 * @param parent - The sized container before the resize.
 * @param to - Its new width and height, world units.
 * @param children - Optional caller-maintained whole-board child index.
 * @returns Every real descendant after the resize, excluding the parent.
 */
export function constrainChildren(
  board: Board,
  parent: BoardObject,
  to: BoxSize,
  children: ChildIndex = buildChildIndex(board),
): readonly BoardObject[] {
  if (!('width' in parent)) return [];
  const walk: ConstraintWalk = { board, children, result: new Map() };
  // Mark the parent visited so malformed parent cycles cannot include it in the result.
  walk.result.set(parent.id, parent);
  for (const id of walk.children.get(parent.id) ?? []) {
    const child = board.objects.get(id);
    if (child !== undefined) constrainChild(walk, child, parent, to);
  }
  walk.result.delete(parent.id);
  return [...walk.result.values()];
}
