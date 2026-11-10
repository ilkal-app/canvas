import { isFarObject } from '@canvas/document';
import { worldTransformOf, type SceneSource } from '@canvas/engine';
import {
  applyTransform,
  invertTransform,
  localBounds,
  type BoardObject,
  type ObjectId,
  type Point,
  type Rect,
} from '@canvas/schema';

import { isDrawableBox } from './drawable-box.js';
import { enteredChainOf } from './entered-group.js';
import type { ResizeAbility } from './handle-layout.js';
import { boxAround, boxCornersOf, type OrientedBox } from './oriented-box.js';
import { isLeftOutOfTransforms } from './transform-exclusion.js';

/**
 * What the select tool reads from the document: objects by id (as the engine's `SceneSource`)
 * and each object's children, which a group's derived box needs. `DocumentStore` provides both
 * (`get`, `references.childrenOf`).
 */
export interface SelectionSource extends SceneSource {
  /**
   * The ids of an object's children.
   *
   * @param id - The parent's id.
   * @returns The children's ids, in no particular order.
   */
  childrenOf(id: ObjectId): Iterable<ObjectId>;
  /**
   * Whether the engine draws an object (the app's hit gate): one it does not draw has no
   * box to select by. Absent, each box is checked on its own (`isDrawableBox`).
   *
   * @param id - The object's id.
   * @returns The gate's verdict.
   */
  isDrawable?(id: ObjectId): boolean;
}

/** The empty child index `localBounds` reads for a line or path, which has no children. */
const NO_CHILDREN = new Map<ObjectId | null, readonly ObjectId[]>();

/**
 * A group's bounds in its own frame: the corners of its children's boxes brought into it.
 *
 * @param group - The group.
 * @param source - The document.
 * @param visiting - Groups on the current path, to stop at a parent cycle.
 * @returns The bounds, or undefined when no child has geometry.
 */
function groupRect(
  group: BoardObject,
  source: SelectionSource,
  visiting: Set<ObjectId>,
): Rect | undefined {
  const worldToGroup = invertTransform(worldTransformOf(group, source));
  const corners: Point[] = [];
  for (const childId of source.childrenOf(group.id)) {
    const box = boxIn(childId, source, visiting);
    if (box)
      for (const corner of boxCornersOf(box)) corners.push(applyTransform(worldToGroup, corner));
  }
  const around = boxAround(corners);
  return around && { x: around.x, y: around.y, width: around.width, height: around.height };
}

/**
 * An object's bounds in its own frame: a boxed object's box, a line's or path's points, a
 * group's children; nothing for connectors (whose route follows their targets: the selection
 * frames them by `selectionBoxOf`, `selection-frame.ts`), comments, empty paths and empty groups.
 *
 * @param object - The object.
 * @param source - The document.
 * @param visiting - Groups on the current path.
 * @returns The bounds, or undefined.
 */
function localRectIn(
  object: BoardObject,
  source: SelectionSource,
  visiting: Set<ObjectId>,
): Rect | undefined {
  switch (object.type) {
    case 'connector':
    case 'comment':
      return undefined;
    case 'group':
      return groupRect(object, source, visiting);
    case 'path':
      if (object.vertices.length === 0) return undefined;
      return localBounds({ objects: new Map([[object.id, object]]) }, object, NO_CHILDREN);
    case 'line':
    case 'freehand':
      return localBounds({ objects: new Map([[object.id, object]]) }, object, NO_CHILDREN);
    default:
      return { x: 0, y: 0, width: object.width, height: object.height };
  }
}

function boxIn(
  id: ObjectId,
  source: SelectionSource,
  visiting: Set<ObjectId>,
): OrientedBox | undefined {
  const object = source.get(id);
  if (!object || visiting.has(id) || source.isDrawable?.(id) === false) return undefined;
  visiting.add(id);
  const rect = localRectIn(object, source, visiting);
  visiting.delete(id);
  return rect && placedBoxOf(object, rect, source);
}

/**
 * An object's bounds in its own frame placed on the board: turned and placed by its world
 * transform, or nothing when the engine does not draw it. Pure.
 *
 * @param object - The object.
 * @param rect - Its bounds in its own frame.
 * @param source - The document.
 * @returns The box, world units, or undefined.
 */
export function placedBoxOf(
  object: BoardObject,
  rect: Rect,
  source: SelectionSource,
): OrientedBox | undefined {
  const transform = worldTransformOf(object, source);
  const corner = applyTransform(transform, { x: rect.x, y: rect.y });
  const box = {
    x: corner.x,
    y: corner.y,
    width: rect.width,
    height: rect.height,
    rotation: Math.atan2(transform.sin, transform.cos),
  };
  // An object the engine does not draw has no box to select by: it stays selectable by id
  // (select all, the layers panel) and deletable, but is left out of the frame, outlines and
  // snapping. The gate's verdict when there is one, else the box's own check.
  if (source.isDrawable !== undefined) return box;
  return isDrawableBox(box, transform.cos, transform.sin) ? box : undefined;
}

/**
 * The box the select tool outlines for one object: its bounds in its own frame (`localBounds` of
 * the schema; a group's derived from its descendants) turned and placed by its world transform.
 * Pure.
 *
 * @param id - The object's id.
 * @param source - The document.
 * @returns The box, world units, or undefined for a missing object, one without geometry, or one
 *   whose box cannot be drawn (not finite, negative or past the engine's `DRAWABLE_EXTENT`,
 *).
 */
export function orientedBoxOf(id: ObjectId, source: SelectionSource): OrientedBox | undefined {
  return boxIn(id, source, new Set());
}

/**
 * The selected objects that are far (`isFarObject`), when the caller has not worked
 * them out already.
 *
 * @param ids - The selected ids.
 * @param source - The document.
 * @param far - The far ones, if known (`selectionScopeOf`).
 * @returns The far ones.
 */
export function farAmong(
  ids: readonly ObjectId[],
  source: SelectionSource,
  far: ReadonlySet<ObjectId> | undefined,
): ReadonlySet<ObjectId> {
  return far ?? new Set(ids.filter((id) => isFarObject(source, id)));
}

/**
 * An object's bounds in its own frame, as the select tool outlines it (`orientedBoxOf` places
 * it): a boxed object's box, a line's or path's points, a group's derived from its children.
 * Pure.
 *
 * @param id - The object's id.
 * @param source - The document.
 * @returns The bounds, or undefined for a missing object or one without geometry.
 */
export function localRectOf(id: ObjectId, source: SelectionSource): Rect | undefined {
  const object = source.get(id);
  return object && localRectIn(object, source, new Set([id]));
}

/**
 * What a click on an object selects: the outermost group around it
 * that is not entered, since groups are selected whole until a double-click enters them, or
 * the object itself when its parent is not a group or is entered (the entered group and each
 * group above it: `enteredChainOf`). Hit testing never returns groups (`hitPoint`).
 *
 * @param id - The object hit.
 * @param source - The document.
 * @param enteredGroupId - The innermost entered group, or null (the default) at the top level.
 * @returns The id to select.
 */
export function selectTargetOf(
  id: ObjectId,
  source: SelectionSource,
  enteredGroupId: ObjectId | null = null,
): ObjectId {
  const entered = enteredChainOf(enteredGroupId, source);
  let target = id;
  const visited = new Set<ObjectId>([id]);
  let parent = parentOf(source.get(id), source);
  while (parent?.type === 'group' && !visited.has(parent.id) && !entered.has(parent.id)) {
    visited.add(parent.id);
    target = parent.id;
    parent = parentOf(parent, source);
  }
  return target;
}

/**
 * Whether one object is an ancestor of another: its parent, its parent's parent, and so on.
 * A parent cycle ends the walk. Pure.
 *
 * @param ancestorId - The candidate ancestor.
 * @param id - The object.
 * @param source - The document.
 * @returns True when `ancestorId` is above `id` in the tree; false for the object itself.
 */
export function isAncestorOf(ancestorId: ObjectId, id: ObjectId, source: SelectionSource): boolean {
  const visited = new Set<ObjectId>([id]);
  for (let parent = parentOf(source.get(id), source); parent; parent = parentOf(parent, source)) {
    if (parent.id === ancestorId) return true;
    if (visited.has(parent.id)) return false;
    visited.add(parent.id);
  }
  return false;
}

/**
 * An object's parent.
 *
 * @param object - The object, or undefined.
 * @param source - The document.
 * @returns The parent, or undefined at the root or for a missing parent.
 */
function parentOf(
  object: BoardObject | undefined,
  source: SelectionSource,
): BoardObject | undefined {
  const parentId = object?.parentId ?? null;
  return parentId === null ? undefined : source.get(parentId);
}

/**
 * Whether any ancestor of an object is among the ids.
 *
 * @param object - The object.
 * @param ids - The ids.
 * @param source - The document.
 * @returns True when an ancestor is listed.
 */
function hasListedAncestor(
  object: BoardObject,
  ids: ReadonlySet<ObjectId>,
  source: SelectionSource,
): boolean {
  const visited = new Set<ObjectId>([object.id]);
  for (let parentId = object.parentId; parentId !== null && !visited.has(parentId);) {
    if (ids.has(parentId)) return true;
    visited.add(parentId);
    parentId = source.get(parentId)?.parentId ?? null;
  }
  return false;
}

/**
 * Whether a group holds a locked object anywhere below it: a group carries its children, so a
 * locked child locks the group's transform (the commands refuse it too). A parent
 * cycle ends the walk.
 *
 * @param group - The group.
 * @param source - The document.
 * @returns True when a descendant is locked.
 */
function holdsLockedObject(group: BoardObject, source: SelectionSource): boolean {
  const seen = new Set<ObjectId>([group.id]);
  const pending = [...source.childrenOf(group.id)];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (seen.has(next)) continue;
    seen.add(next);
    if (source.get(next)?.locked === true) return true;
    pending.push(...source.childrenOf(next));
  }
  return false;
}

/**
 * The selected objects a marquee keeps and a transform starts from: those that exist and are
 * not locked, without any whose ancestor is selected too, since that ancestor
 * carries it (the commands refuse moving an object twice). A group holding a locked object is
 * kept: it is selectable by marquee as by click. Pure.
 *
 * @param ids - The selected ids.
 * @param source - The document.
 * @returns The ids, in selection order.
 */
export function unlockedTopmostIds(ids: readonly ObjectId[], source: SelectionSource): ObjectId[] {
  const listed = new Set(ids);
  return ids.filter((id) => {
    const object = source.get(id);
    return object !== undefined && !object.locked && !hasListedAncestor(object, listed, source);
  });
}

/**
 * The selected groups that hold a locked object anywhere below them: a locked child locks its
 * group's transform and keeps the Delete key from deleting it. O(the groups' subtrees).
 * Pure.
 *
 * @param ids - The selected ids.
 * @param source - The document.
 * @returns The groups' ids, in selection order.
 */
export function groupsHoldingLocked(ids: readonly ObjectId[], source: SelectionSource): ObjectId[] {
  return ids.filter((id) => {
    const object = source.get(id);
    return object?.type === 'group' && holdsLockedObject(object, source);
  });
}

/**
 * The selected objects Delete changes, and the base every transform starts from
 * (`unlockedTopmostIds`), without groups holding a locked object (the commands refuse
 * to transform them too). A transform takes `nearIds` (`SelectionScope.near`), which further
 * leaves out what `isLeftOutOfTransforms` names: far objects and those the engine does not draw. Pure; O(the selected groups' subtrees), so callers that run per
 * pointer move keep it out of their path (the controller caches it through `isResizable`).
 *
 * @param ids - The selected ids.
 * @param source - The document.
 * @returns The ids to transform, in selection order.
 */
export function transformableIds(ids: readonly ObjectId[], source: SelectionSource): ObjectId[] {
  const held = new Set(groupsHoldingLocked(ids, source));
  return unlockedTopmostIds(ids, source).filter((id) => !held.has(id));
}

/**
 * Which resize handles apply: something can be transformed and every object that would be
 * stores a box or is a group (`resizeObjects` scales a group's descendants; it refuses
 * lines, paths and connectors, whose bounds are drawn from points). A lone group whose derived
 * box has no length along an axis cannot scale along it, so it offers only the other axis's
 * edge handles, or none. Rotation and moves work on anything. An object the engine does not draw
 * (`isDrawable`) is left out, as every transform leaves it out (`isLeftOutOfTransforms`).
 *
 * @param ids - The selected ids.
 * @param source - The document.
 * @param far - The selected objects that are far, when already worked out (`selectionScopeOf`);
 *   a transform skips them, so they offer no handle.
 * @returns Which handles the selection offers (`ResizeAbility`).
 */
export function isResizable(
  ids: readonly ObjectId[],
  source: SelectionSource,
  far?: ReadonlySet<ObjectId>,
): ResizeAbility {
  const isFar = farAmong(ids, source, far);
  const movable = transformableIds(ids, source).filter(
    (id) => !isLeftOutOfTransforms(id, source, isFar),
  );
  return resizeAbilityOf(movable, source);
}

/**
 * Which resize handles a known transform scope offers, without rechecking its membership.
 *
 * @param movable - The near, transformable ids from the current selection scope.
 * @param source - The document used to compute that scope.
 * @returns All handles, one axis, or none, as `isResizable`.
 */
export function resizeAbilityOf(
  movable: readonly ObjectId[],
  source: SelectionSource,
): ResizeAbility {
  const isBoxed = movable.every((id) => {
    const object = source.get(id);
    return object !== undefined && (object.type === 'group' || 'width' in object);
  });
  if (movable.length === 0 || !isBoxed) return false;
  const [only] = movable;
  if (movable.length > 1 || only === undefined || source.get(only)?.type !== 'group') return true;
  const rect = localRectOf(only, source);
  const hasWidth = rect !== undefined && rect.width > 0;
  const hasHeight = rect !== undefined && rect.height > 0;
  if (hasWidth && hasHeight) return true;
  return hasWidth ? 'x' : hasHeight ? 'y' : false;
}
