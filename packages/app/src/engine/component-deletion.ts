import type { BoardReader } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

/**
 * What deleting objects would do to components (ruling 6): the live mains it deletes
 * and how many of their instances, not deleted with them, it would make plain objects.
 */
export interface ComponentDeletion {
  /** The first deleted main's name, in the order the objects were given. */
  readonly name: string;
  /** How many live mains the deletion deletes, at least 1. */
  readonly mainCount: number;
  /** How many instances would become plain objects, at least 1. */
  readonly instanceCount: number;
}

/**
 * Whether deleting objects deletes a live main with an instance that would survive it, and so
 * become plain objects (`deleteObjects` detaches it): the objects with their descendants are
 * what is deleted; an instance deleted with them is not counted, and an instance of two
 * deleted mains counts once. Reads only the deleted subtrees and the mains' instances. Pure.
 *
 * @param board - The document as the deletion sees it.
 * @param ids - The objects to delete.
 * @returns What the person should be asked about, or undefined when no instance would change.
 */
export function componentDeletionOf(
  board: BoardReader,
  ids: readonly ObjectId[],
): ComponentDeletion | undefined {
  const deleting = new Set<ObjectId>();
  const pending = [...ids];
  const mains: { readonly id: ObjectId; readonly name: string }[] = [];
  for (let id = pending.shift(); id !== undefined; id = pending.shift()) {
    const object = board.get(id);
    if (object === undefined || deleting.has(id)) continue;
    deleting.add(id);
    if (object.type === 'component' && !object.retired) mains.push(object);
    pending.push(...board.references.childrenOf(id));
  }
  const detached = new Set<ObjectId>();
  for (const main of mains) {
    for (const id of board.references.instancesOf(main.id)) {
      if (!deleting.has(id)) detached.add(id);
    }
  }
  const [first] = mains;
  if (first === undefined || detached.size === 0) return undefined;
  return { name: first.name, mainCount: mains.length, instanceCount: detached.size };
}

/**
 * The confirmation's question (ruling 6): "Delete component “Card”? Its 3 instances
 * become plain objects."
 *
 * @param deletion - What the deletion would do.
 * @returns The sentence.
 */
export function deletionQuestion(deletion: ComponentDeletion): string {
  const { name, mainCount, instanceCount } = deletion;
  const what = mainCount === 1 ? `component “${name}”` : `${String(mainCount)} components`;
  const owner = mainCount === 1 ? 'Its' : 'Their';
  const instances =
    instanceCount === 1
      ? 'instance becomes a plain object'
      : `${String(instanceCount)} instances become plain objects`;
  return `Delete ${what}? ${owner} ${instances}.`;
}
