import {
  instanceReferenceProblems,
  MAX_INSTANCES,
  type BoardObject,
  type ObjectId,
  type PrincipalId,
} from '@canvas/schema';

import type { TransactionOrigin } from '../origin/transaction-origin.js';
import type { DocumentStore } from '../store/document-store.js';

import { commandError, type CommandError } from './command-error.js';

/**
 * Finds a foreign main anywhere in an object's ancestry, including the object itself.
 *
 * @param board - The before or proposed board.
 * @param board.get - Reads an object by identity.
 * @param id - The written identity.
 * @param mayWriteUnder - Whether a main's creator lets the change through.
 * @returns The first protected main, if any.
 */
function foreignMain(
  board: { get(id: ObjectId): BoardObject | undefined },
  id: ObjectId,
  mayWriteUnder: (createdBy: PrincipalId) => boolean,
): ObjectId | undefined {
  const seen = new Set<ObjectId>();
  let object = board.get(id);
  while (object !== undefined && !seen.has(object.id)) {
    seen.add(object.id);
    if (object.type === 'component' && !mayWriteUnder(object.createdBy)) return object.id;
    object = object.parentId === null ? undefined : board.get(object.parentId);
  }
  return undefined;
}

/**
 * Checks definition ownership before and after every planned write.
 *
 * @param before - Original board.
 * @param before.get - Reads the original object.
 * @param after - Proposed board.
 * @param after.get - Reads the proposed object.
 * @param written - Changed identities.
 * @param origin - Command actor.
 * @param removableUnder - Other creators whose mains the agent may remove objects under.
 * @returns At most one refusal, before any transaction starts.
 */
function ownershipErrors(
  before: { get(id: ObjectId): BoardObject | undefined },
  after: { get(id: ObjectId): BoardObject | undefined },
  written: ReadonlyMap<ObjectId, BoardObject | null>,
  origin: TransactionOrigin,
  removableUnder: ReadonlySet<PrincipalId>,
): CommandError[] {
  if (origin.kind !== 'agent') return [];
  const isOwn = (createdBy: PrincipalId): boolean => createdBy === origin.principalId;
  // A removed object may sit under a same-operator agent's main; a removed main itself
  // is never in the plan (deleting a main retires it, a rewrite judged as its own write).
  const mayRemoveUnder = (createdBy: PrincipalId): boolean =>
    isOwn(createdBy) || removableUnder.has(createdBy);
  for (const [id, next] of written) {
    const main =
      foreignMain(before, id, next === null ? mayRemoveUnder : isOwn) ??
      foreignMain(after, id, isOwn);
    if (main !== undefined)
      return [
        commandError('not-own-main', main, [], 'An agent may edit only its own main definitions.'),
      ];
    const previous = before.get(id);
    if (
      previous?.type === 'instance' &&
      next?.type === 'frame' &&
      previous.createdBy !== origin.principalId
    ) {
      return [
        commandError('not-own-object', id, [], 'An agent may detach only its own instances.'),
      ];
    }
  }
  return [];
}

/**
 * Enforces component references, the stored-instance cap and agent main ownership atomically.
 *
 * @param store - Current document.
 * @param written - Recorded command writes, before mutation.
 * @param origin - Command actor.
 * @param removableUnder - Other creators whose mains an agent may remove objects under
 *   (the writer's operator's agents); none by default.
 * @returns A refusal, or no errors when the whole plan is admissible.
 */
export function componentWriteErrors(
  store: DocumentStore,
  written: ReadonlyMap<ObjectId, BoardObject | null>,
  origin: TransactionOrigin,
  removableUnder: ReadonlySet<PrincipalId> = new Set(),
): CommandError[] {
  if (written.size === 0) return [];
  const afterReader = {
    get: (id: ObjectId) => (written.has(id) ? (written.get(id) ?? undefined) : store.get(id)),
  };
  const ownership = ownershipErrors(store, afterReader, written, origin, removableUnder);
  if (ownership.length > 0) return ownership;
  const isStructural = [...written].some(([id, next]) => {
    const previous = store.get(id);
    if (next === null) return previous?.type === 'component' || previous?.type === 'instance';
    return (
      (next.type === 'instance' &&
        (previous?.type !== 'instance' || previous.mainId !== next.mainId)) ||
      (previous !== undefined &&
        (previous.parentId !== next.parentId || previous.type !== next.type))
    );
  });
  if (!isStructural) return [];
  const before = store.read();
  const objects = new Map(before.objects);
  for (const [id, object] of written) {
    if (object === null) objects.delete(id);
    else objects.set(id, object);
  }
  const after = { ...before, objects };

  let count = 0;
  for (const object of objects.values()) if (object.type === 'instance') count += 1;
  if (count > MAX_INSTANCES)
    return [
      commandError('too-many-instances', null, [], 'A board may hold at most 10,000 instances.'),
    ];
  for (const [id, object] of written) {
    if (object?.type !== 'instance') continue;
    const previous = before.objects.get(id);
    if (previous?.type === 'instance' && previous.mainId === object.mainId) continue;
    const main = objects.get(object.mainId);
    if (main?.type === 'component' && main.retired)
      return [commandError('retired-main', id, ['mainId'], 'New instances require a live main.')];
  }
  const oldProblems = instanceReferenceProblems(before);
  for (const [id, problem] of instanceReferenceProblems(after)) {
    if (oldProblems.get(id)?.code === problem.code) continue;
    return [
      commandError(
        problem.code,
        id,
        ['mainId'],
        'The placement violates component reference limits.',
      ),
    ];
  }
  return [];
}
