import {
  autoLayoutTree,
  constrainChildren,
  laidInstanceSize,
  layOutStack,
  variantSizedAxes,
  type AutoLayout,
  type BoardObject,
  type InstanceObject,
  type ObjectId,
} from '@canvas/schema';

import type { BoxSource } from '../bound/box-source.js';
import { validateObject } from '../store/object-validation.js';

/** What the relayout reads of a board: objects, children and the instances of a main. */
export interface RelayoutSource extends BoxSource {
  /**
   * The instances of a main.
   *
   * @param mainId - The main.
   * @returns The instance ids, in no order.
   */
  instancesOf(mainId: ObjectId): Iterable<ObjectId>;
}

/** A box: the objects a stack lays out, which have their own width and height. */
type Box = Extract<BoardObject, { width: number; height: number }>;

/** An auto-layout container reached by a change, with its layout. */
interface Reached {
  /** The frame or main. */
  readonly container: Box;
  /** Its live auto-layout. */
  readonly layout: AutoLayout;
}

/**
 * Whether an object is a box (it has a stored width and height).
 *
 * @param object - The object.
 * @returns True for a box.
 */
function isBox(object: BoardObject): object is Box {
  return 'width' in object && 'height' in object;
}

/**
 * The outermost auto-layout container whose layout an object's change can reach: the object
 * itself if it is one, else its parent if that is one, then up through auto-layout ancestors (a
 * hugging container's new size moves its siblings in its own auto-layout parent). Stops at the
 * first container without auto-layout.
 *
 * @param source - The board.
 * @param id - The object, or a parent it had.
 * @returns The outermost such container, or undefined when none is reached.
 */
function outermostReached(source: BoxSource, id: ObjectId): Reached | undefined {
  let current = source.get(id);
  if (current === undefined) return undefined;
  let reached = reachedOf(current);
  const seen = new Set<ObjectId>([current.id]);
  while (current.parentId !== null && !seen.has(current.parentId)) {
    const parent = reachedOf(source.get(current.parentId));
    if (parent === undefined) break;
    reached = parent;
    seen.add(parent.container.id);
    current = parent.container;
  }
  return reached;
}

/**
 * An object as an auto-layout container, when it is one.
 *
 * @param object - Any object, or nothing.
 * @returns The container and its layout, or undefined.
 */
function reachedOf(object: BoardObject | undefined): Reached | undefined {
  if (object?.type !== 'frame' && object?.type !== 'component') return undefined;
  return object.autoLayout === undefined
    ? undefined
    : { container: object, layout: object.autoLayout };
}

/**
 * An object with a new position and size, or itself when nothing changed.
 *
 * @param object - The object.
 * @param placement - Where the layout puts it: in its parent's frame, and its size.
 * @param placement.x - Left in the parent's frame; ignored for the laid root.
 * @param placement.y - Top in the parent's frame; ignored for the laid root.
 * @param placement.width - Its width.
 * @param placement.height - Its height.
 * @param isRoot - Whether it is the laid root, which keeps its own position.
 * @returns The changed object, or undefined when nothing changed.
 */
function placed(
  object: Box,
  placement: { x: number; y: number; width: number; height: number },
  isRoot: boolean,
): Box | undefined {
  const x = isRoot ? object.x : placement.x;
  const y = isRoot ? object.y : placement.y;
  const { width, height } = placement;
  if (x === object.x && y === object.y && width === object.width && height === object.height) {
    return undefined;
  }
  // A size or place a peer left invalid (a hostile raw write) lays out to nonsense: that object
  // keeps what it has rather than being written invalid, which would refuse the whole command.
  if (![x, y, width, height].every(Number.isFinite) || width < 0 || height < 0) return undefined;
  return { ...object, x, y, width, height };
}

/**
 * Plans the live auto-layout a change calls for: every auto-layout frame or main that
 * a touched object is, is in, or was in, re-laid with `layOutStack` from its outermost auto-layout
 * ancestor down (nested auto-layout containers as sub-stacks), so each box child gets the place
 * and size its container's stack gives it and each hugging container its content's size. A main
 * that hugs gives its instances its new size on each axis they have not fixed (`isWidthFixed`,
 * `isHeightFixed`), and so does a main whose variants size it, whatever its layout.
 * Children ignore `constraints` inside an auto-layout container, but a frame
 * or main the layout resizes that has no auto-layout of its own maps its descendants to its new
 * size by their constraints, as a resize does, locked ones excepted. Text heights
 * are as stored: the app re-measures text whose width the layout changes, and that write is laid
 * out in turn. Pure: reads `source`, mutates nothing; cost follows the containers reached and the
 * subtrees of the frames it resizes.
 *
 * @param source - The board as the change leaves it.
 * @param touched - The objects the change wrote or deleted, and the parents they had before it.
 * @returns The objects the layout changes, whole, by id; empty when none.
 */
export function planRelayout(
  source: RelayoutSource,
  touched: Iterable<ObjectId>,
): Map<ObjectId, BoardObject> {
  const written = new Map<ObjectId, BoardObject>();
  // Each round reads the board with the earlier rounds' writes, so an instance a hugging main
  // resized is laid out in its own stack (and that stack's ancestors) in the next round.
  const current: RelayoutSource = {
    get: (id) => written.get(id) ?? source.get(id),
    childrenOf: (id) => source.childrenOf(id),
    instancesOf: (mainId) => source.instancesOf(mainId),
  };
  let pending = new Set(touched);
  for (let round = 0; pending.size > 0 && round < MAX_RELAYOUT_ROUNDS; round += 1) {
    pending = relayoutRound(current, pending, written);
  }
  return written;
}

/**
 * The most rounds one relayout takes: one per level of instances in mains in stacks, and of
 * auto-layout containers a resized frame's constraints resize, which the instance depth limit and
 * the board's nesting bound well below this; a guard against a cycle a peer's raw write made.
 */
const MAX_RELAYOUT_ROUNDS = 32;

/**
 * One round of {@link planRelayout}: sizes each touched instance of an auto-layout main, then lays
 * out every auto-layout container `touched` reaches, recording the changes in `written`.
 *
 * @param source - The board as the change and the earlier rounds leave it.
 * @param touched - The objects to lay out from.
 * @param written - The changes so far, added to.
 * @returns The instances of every main this round laid out, changed or not, and every auto-layout
 *   container a resized box's constraints resized, which the next round sizes and lays out from.
 */
function relayoutRound(
  source: RelayoutSource,
  touched: Iterable<ObjectId>,
  written: Map<ObjectId, BoardObject>,
): Set<ObjectId> {
  const roots = new Map<ObjectId, Reached>();
  for (const id of touched) {
    // Walks the object's own auto-layout ancestors, so a child of a container reaches it.
    const reached = outermostReached(source, id);
    if (reached !== undefined) roots.set(reached.container.id, reached);
  }
  // Touched instances take their laid size first (an override hid a child or carried a new
  // measured size; a main laid last round passed its instances here), so a stack
  // laid out below has the last word on a stretched or filling instance.
  for (const id of touched) {
    const instance = source.get(id);
    if (instance?.type !== 'instance') continue;
    const next = sizedInstance(source, instance);
    if (next !== undefined) written.set(instance.id, next);
  }
  const next = new Set<ObjectId>();
  // A main whose variants size it passes its instances on whatever its layout, so a preset edit
  // gives each its variant's size; a main with auto-layout passes them below anyway.
  for (const id of touched) {
    const main = source.get(id);
    if (main?.type !== 'component' || main.autoLayout !== undefined) continue;
    const sized = variantSizedAxes(main);
    if (!sized.isWidthSized && !sized.isHeightSized) continue;
    for (const instanceId of source.instancesOf(main.id)) next.add(instanceId);
  }
  for (const [rootId, { container }] of roots) {
    const tree = autoLayoutTree(source, container);
    if (tree === undefined) continue;
    for (const placement of layOutStack(tree)) {
      const object = source.get(placement.key as ObjectId);
      if (object === undefined || !isBox(object)) continue;
      // An instance depends on its main's content even when the main's own box is unchanged:
      // its overrides can hide what set the main's size. So every main laid here passes on its
      // instances, the root included.
      if (object.type === 'component') {
        for (const instanceId of source.instancesOf(object.id)) {
          next.add(instanceId);
        }
      }
      const changed = placed(object, placement, placement.key === rootId);
      if (changed === undefined) continue;
      written.set(object.id, changed);
      for (const id of constrainedBy(source, object, changed, written)) next.add(id);
    }
  }
  return next;
}

/**
 * Maps the descendants of a frame or main the layout resized to its new size by their
 * constraints: a stretched background grows with a filling frame, as `resizeObjects`
 * maps them when a person resizes it. A locked descendant keeps its box, and so does everything
 * under it, as `resizeObjects` leaves a locked constrained child. An auto-layout container places
 * its own children, so it maps nothing; nor does a box whose size the layout kept, or one whose
 * new size the store would refuse (`relayoutOf` leaves that write out, so its children stay).
 *
 * @param source - The board as the change and the earlier rounds leave it.
 * @param before - The box as it was.
 * @param after - The box as the layout places it.
 * @param written - The changes so far, added to.
 * @returns The auto-layout containers among the descendants whose size the constraints changed,
 *   which must be laid out in turn.
 */
function constrainedBy(
  source: RelayoutSource,
  before: Box,
  after: Box,
  written: Map<ObjectId, BoardObject>,
): ObjectId[] {
  if (before.type !== 'frame' && before.type !== 'component') return [];
  if (before.autoLayout !== undefined) return [];
  if (before.width === after.width && before.height === after.height) return [];
  if (!validateObject(after, before).isValid) return [];
  const objects = new Map<ObjectId, BoardObject>([[before.id, before]]);
  const children = new Map<ObjectId | null, readonly ObjectId[]>();
  const pending = [before.id];
  for (const id of pending) {
    const ids = [...source.childrenOf(id)];
    children.set(id, ids);
    for (const childId of ids) {
      const child = source.get(childId);
      // A locked child is left out of the walk, so it and everything under it keep their boxes.
      if (child === undefined || child.locked || objects.has(childId)) continue;
      objects.set(childId, child);
      pending.push(childId);
    }
  }
  const laid: ObjectId[] = [];
  const size = { width: after.width, height: after.height };
  for (const object of constrainChildren({ objects }, before, size, children)) {
    const stored = objects.get(object.id);
    if (stored === undefined || JSON.stringify(stored) === JSON.stringify(object)) continue;
    written.set(object.id, object);
    if (reachedOf(object) !== undefined) laid.push(object.id);
  }
  return laid;
}

/**
 * An instance at the size its main's auto-layout gives it with its own overrides (
 * `laidInstanceSize`; hidden children out of the flow, overridden text at its measured size), on
 * the axes the main hugs and the instance has not fixed.
 *
 * @param source - The board.
 * @param instance - The instance.
 * @returns The resized instance, or undefined when its size is unchanged or would be invalid.
 */
function sizedInstance(source: RelayoutSource, instance: InstanceObject): BoardObject | undefined {
  const main = source.get(instance.mainId);
  if (main === undefined) return undefined;
  const { width, height } = laidInstanceSize(source, instance, main);
  if (![width, height].every((value) => Number.isFinite(value) && value >= 0)) return undefined;
  if (width === instance.width && height === instance.height) return undefined;
  return { ...instance, width, height };
}
