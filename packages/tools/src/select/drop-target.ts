import type {
  CommandEnvironment,
  CommandError,
  DocumentStore,
  TransactionOrigin,
} from '@canvas/document';
import type { BoardObject, ObjectId } from '@canvas/schema';

import { boxCentreOf, isInsideBox, type OrientedBox } from './oriented-box.js';
import type { SelectHitTester } from './select-hit-tester.js';
import { orientedBoxOf, type SelectionSource } from './selection-geometry.js';
import { isStackedType, stackLayoutOf, stackSlotOf, type StackSlot } from './stack-reorder.js';
import { previewObjects, runTransformPlan, type TransformPlan } from './transform-plan.js';

// Where a moved object lands: on release of a move,
// each object goes into the top-most frame under its centre, or onto the root when there is
// none, so an object dragged out of a frame leaves it and one dropped inside a frame joins it.
// Frames that move with the gesture (the objects themselves and anything inside them) take
// nothing: their place on the board is still the old one in the hit-test index. An object
// whose parent is a group moves with its group and is never taken out of it.

/** A move plan. */
type MovePlan = TransformPlan & { readonly kind: 'move' };

/**
 * The document with some objects replaced by their new state.
 *
 * @param document - The document.
 * @param objects - The new states.
 * @returns The source.
 */
function withObjects(document: SelectionSource, objects: readonly BoardObject[]): SelectionSource {
  const byId = new Map(objects.map((object) => [object.id, object]));
  return {
    get: (id) => byId.get(id) ?? document.get(id),
    childrenOf: (id) => document.childrenOf(id),
  };
}

/**
 * The document with a move's objects previewed on demand: each moved object is moved when it is
 * first read, so a reader that stops early previews only what it read. The same
 * objects as `withObjects(document, previewObjects(plan, document))`: a move previews each
 * object on its own.
 *
 * @param document - The document.
 * @param plan - The move.
 * @param movedIds - Its ids as a set.
 * @returns The source.
 */
function withMoveOnDemand(
  document: SelectionSource,
  plan: MovePlan,
  movedIds: ReadonlySet<ObjectId>,
): SelectionSource {
  const previewed = new Map<ObjectId, BoardObject | undefined>();
  const previewOf = (id: ObjectId): BoardObject | undefined => {
    if (!previewed.has(id)) {
      const [object] = previewObjects({ ...plan, ids: [id] }, document);
      previewed.set(id, object);
    }
    return previewed.get(id);
  };
  return {
    get: (id) => (movedIds.has(id) ? (previewOf(id) ?? document.get(id)) : document.get(id)),
    // Only boxes are measured here (groups are never stacked), so children are the document's.
    childrenOf: document.childrenOf.bind(document),
  };
}

/**
 * Whether a frame moves with the gesture: it is moved, or one of its ancestors is.
 *
 * @param frameId - The frame.
 * @param movedIds - The objects the gesture moves.
 * @param document - The document.
 * @returns True when the frame moves.
 */
function isMoving(
  frameId: ObjectId,
  movedIds: ReadonlySet<ObjectId>,
  document: SelectionSource,
): boolean {
  const seen = new Set<ObjectId>();
  for (let id: ObjectId | null = frameId; id !== null && !seen.has(id);) {
    if (movedIds.has(id)) return true;
    seen.add(id);
    id = document.get(id)?.parentId ?? null;
  }
  return false;
}

/**
 * Where one moved object lands: the top-most frame, not moving with the gesture, under the
 * centre of its box after the move, or the root.
 *
 * @param object - The object, as the document holds it.
 * @param movedIds - The objects the gesture moves.
 * @param moved - The document with the moved objects' new state.
 * @param document - The document.
 * @param hitTester - Finds frames under a point.
 * @returns The frame, `null` for the root, or undefined when the object does not change parent
 *   by a drop (its parent is a group, or it has no box of its own).
 */
function landingOf(
  object: BoardObject,
  movedIds: ReadonlySet<ObjectId>,
  moved: SelectionSource,
  document: SelectionSource,
  hitTester: SelectHitTester,
): ObjectId | null | undefined {
  const parent = object.parentId === null ? undefined : document.get(object.parentId);
  const box = orientedBoxOf(object.id, moved);
  if (parent?.type === 'group' || box === undefined) return undefined;
  const isEligible = (frameId: ObjectId) => !isMoving(frameId, movedIds, document);
  return hitTester.frameAt(boxCentreOf(box), isEligible) ?? null;
}

/**
 * Adds the drops to a move plan at release: the new parent of every moved object that lands in
 * a frame other than its own, or leaves its frame for the root. The command converts each
 * position into the new parent's frame, so nothing jumps. Other plans are returned as they are.
 * Pure: reads the document and the hit tester.
 *
 * @param plan - The gesture's plan, against the document before the command.
 * @param document - The document.
 * @param hitTester - Finds frames under a point, from the document's index.
 * @returns The plan with `parentIds` for a move.
 */
export function withDropTargets(
  plan: TransformPlan,
  document: SelectionSource,
  hitTester: SelectHitTester,
): TransformPlan {
  if (plan.kind !== 'move') return plan;
  const moved = withObjects(document, previewObjects(plan, document));
  const movedIds = new Set(plan.ids);
  const parentIds = new Map<ObjectId, ObjectId | null>();
  for (const object of plan.ids.flatMap((id) => document.get(id) ?? [])) {
    const landing = landingOf(object, movedIds, moved, document, hitTester);
    if (landing !== undefined && landing !== object.parentId) parentIds.set(object.id, landing);
  }
  return { ...plan, parentIds };
}

/**
 * The frame the primary object would land in if the move were released now, for the overlay to
 * outline during the drag: the primary object when it moves, else the first moved object. Its
 * own frame while it stays inside it; nothing over bare board. O(depth) plus one point query.
 *
 * @param plan - The drag's move plan.
 * @param primaryId - The selection's primary object.
 * @param document - The document.
 * @param hitTester - Finds frames under a point.
 * @param movedIds - The plan's ids as a set, which a gesture builds once.
 * @returns The frame's box, world units, or undefined.
 */
export function dropTargetBox(
  plan: MovePlan,
  primaryId: ObjectId | undefined,
  document: SelectionSource,
  hitTester: SelectHitTester,
  movedIds: ReadonlySet<ObjectId> = new Set(plan.ids),
): OrientedBox | undefined {
  const id = plan.ids.find((movedId) => movedId === primaryId) ?? plan.ids[0];
  const object = id === undefined ? undefined : document.get(id);
  if (object === undefined) return undefined;
  const moved = withObjects(document, previewObjects({ ...plan, ids: [object.id] }, document));
  const landing = landingOf(object, movedIds, moved, document, hitTester);
  return landing ? orientedBoxOf(landing, document) : undefined;
}

/**
 * The auto-layout main a moved box stays in: its parent, when that is a main with a live
 * auto-layout and the box's centre is still inside it after the move. The drop rule finds only
 * frames, so a reorder inside a main needs this; a box is never dropped into a main.
 *
 * @param object - The moved box, as the document holds it.
 * @param moved - The document with the moved objects' new state.
 * @param document - The document.
 * @returns The main's id, or undefined.
 */
function ownMainOf(
  object: BoardObject,
  moved: SelectionSource,
  document: SelectionSource,
): ObjectId | undefined {
  const parent = object.parentId === null ? undefined : document.get(object.parentId);
  if (parent?.type !== 'component' || stackLayoutOf(parent) === undefined) return undefined;
  const box = orientedBoxOf(object.id, moved);
  const area = orientedBoxOf(parent.id, document);
  return box && area && isInsideBox(area, boxCentreOf(box)) ? parent.id : undefined;
}

/**
 * Where a move puts the moved boxes in a live auto-layout's stack, when every moved
 * object is a box that lands (stays, or is dropped) in the same frame or main with an
 * auto-layout: the slot the primary object's centre is in after the move. Undefined otherwise,
 * and the move then runs as a plain move. Pure: reads the document and the hit tester.
 *
 * @param plan - The move plan.
 * @param primaryId - The selection's primary object.
 * @param document - The document.
 * @param hitTester - Finds frames under a point.
 * @param movedIds - The plan's ids as a set, which a gesture builds once.
 * @returns The slot, or undefined.
 */
export function stackDropOf(
  plan: MovePlan,
  primaryId: ObjectId | undefined,
  document: SelectionSource,
  hitTester: SelectHitTester,
  movedIds: ReadonlySet<ObjectId> = new Set(plan.ids),
): StackSlot | undefined {
  const moved = withMoveOnDemand(document, plan, movedIds);
  const landingOfBox = (object: BoardObject) =>
    isStackedType(object)
      ? (ownMainOf(object, moved, document) ??
        landingOf(object, movedIds, moved, document, hitTester))
      : undefined;
  // Every moved box must land in one container with a live auto-layout. The first one's landing
  // settles most moves (over bare board or a plain frame) without measuring the others, so a
  // drag of many boxes costs one landing per move, not one per box.
  let containerId: ObjectId | null | undefined;
  let isFirst = true;
  for (const id of plan.ids) {
    const object = document.get(id);
    if (object === undefined) continue;
    const landing = landingOfBox(object);
    if (isFirst) {
      isFirst = false;
      containerId = landing;
      if (typeof containerId !== 'string') return undefined;
      if (stackLayoutOf(document.get(containerId)) === undefined) return undefined;
    } else if (landing !== containerId) {
      return undefined;
    }
  }
  if (typeof containerId !== 'string') return undefined;
  const primary = plan.ids.find((id) => id === primaryId) ?? plan.ids[0];
  const box = primary === undefined ? undefined : orientedBoxOf(primary, moved);
  return box && stackSlotOf(containerId, movedIds, boxCentreOf(box), document);
}

/**
 * A plan without its drops: a move that keeps every object in its parent. Other plans, and a
 * move with no drops, are returned as they are.
 *
 * @param plan - The plan.
 * @returns The plain plan.
 */
export function withoutDropTargets(plan: TransformPlan): TransformPlan {
  if (plan.kind !== 'move' || plan.parentIds === undefined || plan.parentIds.size === 0) {
    return plan;
  }
  return { kind: 'move', ids: plan.ids, delta: plan.delta };
}

/**
 * Runs a gesture's plan as its one command. When the document refuses a move that also drops
 * objects into frames (a drop target whose top child has a stacking key a peer wrote that is not
 * a fractional-index key, say), the refused command wrote nothing, so the move runs again
 * without the drops: the objects still go where the pointer put them, keeping their parents,
 * and the gesture still makes one change set and one undo step.
 *
 * @param store - The document.
 * @param origin - Who the change is attributed to.
 * @param environment - The command clock and id generator.
 * @param plan - The plan, with its drops.
 * @returns The errors of the refused command, for the caller to report; empty when it ran.
 */
export function runDropPlan(
  store: DocumentStore,
  origin: TransactionOrigin,
  environment: CommandEnvironment,
  plan: TransformPlan,
): readonly CommandError[] {
  const outcome = runTransformPlan(store, origin, environment, plan);
  if (outcome.status === 'applied') return [];
  const plain = withoutDropTargets(plan);
  if (plain !== plan) runTransformPlan(store, origin, environment, plain);
  return outcome.errors;
}
