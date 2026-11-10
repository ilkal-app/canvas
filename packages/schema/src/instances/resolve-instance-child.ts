import type { Board } from '../board/board.js';
import { isStoredHidden, withoutStoredHidden } from '../fields/visibility.js';
import { scaledObject } from '../geometry/scaled-object.js';
import type { ObjectId } from '../ids/object-id.js';
import type { BoardObject } from '../objects/board-object.js';
import type { InstanceObject } from '../objects/instance-object.js';

import { constrainChildren } from './constrain-children.js';
import { effectiveOverrides } from './effective-overrides.js';
import { autoLayoutOf, unscaledInstance } from './instance-layout.js';
import type { InstanceOverrides } from './instance-overrides.js';
import { applyInstanceOverride } from './override-content.js';
import { hasGeometry } from './preset-geometry.js';
import { virtualObjectId } from './resolve-instance.js';
import { recordAt } from './slot-expansion.js';

/** A child with a virtual copy in the instance. */
export interface ShownInstanceChild {
  /** The child has a virtual copy. */
  readonly kind: 'shown';
  /** The copy, equal to its `resolveInstance` entry. */
  readonly object: BoardObject;
}

/** A child an override hides, directly or through an ancestor. */
export interface HiddenInstanceChild {
  /** The child has no virtual copy. */
  readonly kind: 'hidden';
}

/** One child's place in an instance after an edit that cannot change the tree's shape. */
export type ResolvedInstanceChild = ShownInstanceChild | HiddenInstanceChild;

/** Types whose virtual copy depends on more than the child itself and its frame ancestry. */
const STRUCTURAL = new Set<BoardObject['type']>([
  'group',
  'frame',
  'component',
  'instance',
  'connector',
  'comment',
]);

/**
 * Resolves the virtual copy of one leaf child of an instance's own main, reading only the child
 * and its ancestors. It equals the matching entry of `resolveInstance`'s output, so a scene
 * can patch one edited child instead of re-resolving the whole instance. Containers, nested
 * instances, connectors and children under a group are refused (`undefined`): their copies depend
 * on siblings or descendants, and the caller resolves the instance in full.
 *
 * @param board - The source board; only the child and its ancestors up to the main are read.
 * @param instance - The real instance.
 * @param childId - A descendant of the instance's main.
 * @param overrides - The records to resolve with; its effective overrides (variant presets under
 *   its own records) when omitted.
 * @returns The child's copy, `hidden` when an override hides it or an ancestor, or `undefined`
 *   when only a full resolution can answer.
 */
export function resolveInstanceChild(
  board: Board,
  instance: InstanceObject,
  childId: ObjectId,
  overrides?: InstanceOverrides,
): ResolvedInstanceChild | undefined {
  const child = board.objects.get(childId);
  const main = board.objects.get(instance.mainId);
  if (child === undefined || main?.type !== 'component' || STRUCTURAL.has(child.type)) {
    return undefined;
  }
  // The chain from the main down to the child: frames only, so constraints read nothing else.
  const chain: ObjectId[] = [child.id];
  let parentId = child.parentId;
  while (parentId !== main.id) {
    const parent = parentId === null ? undefined : board.objects.get(parentId);
    if (parent?.type !== 'frame' || chain.includes(parent.id)) return undefined;
    chain.unshift(parent.id);
    parentId = parent.parentId;
  }
  // Under auto-layout a sibling's size or visibility moves the child: only a full
  // resolve places it.
  if (
    [main.id, ...chain.slice(0, -1)].some((id) => autoLayoutOf(board.objects.get(id)) !== undefined)
  ) {
    return undefined;
  }
  const records = overrides ?? effectiveOverrides(instance, main);
  // A record that moves, sizes or lays out the main or the chain changes where the
  // child is: only a full resolve, which reads the main as the records draw it, places it.
  if ([main.id, ...chain].some((id) => hasGeometry(recordAt(records, id)))) return undefined;
  // A record says either way; else the stored visibility.
  if (
    chain.some((id) => recordAt(records, id)?.isHidden ?? isStoredHidden(board.objects.get(id)))
  ) {
    return { kind: 'hidden' };
  }
  const children = new Map<ObjectId | null, readonly ObjectId[]>();
  let at: ObjectId = main.id;
  for (const id of chain) {
    children.set(at, [id]);
    at = id;
  }
  const mapped = constrainChildren(board, main, unscaledInstance(instance), children).find(
    ({ id }) => id === child.id,
  );
  const record = recordAt(records, child.id);
  const object =
    record === undefined ? (mapped ?? child) : applyInstanceOverride(mapped ?? child, record);
  // A scaled instance draws its copy larger, as `resolveInstance` does.
  return {
    kind: 'shown',
    object: scaledObject(
      {
        // Shown, so without the main's stored visibility, as `resolveInstance` draws it.
        ...withoutStoredHidden(object),
        id: virtualObjectId(instance.id, child.id) as ObjectId,
        parentId:
          child.parentId === main.id
            ? instance.id
            : (virtualObjectId(instance.id, child.parentId ?? '') as ObjectId),
        pageId: null,
      },
      instance.scale ?? 1,
    ),
  };
}
