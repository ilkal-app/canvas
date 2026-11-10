import type { ObjectId } from '@canvas/schema';

import type { TransactionOrigin } from '../origin/transaction-origin.js';
import type { DocumentStore } from '../store/document-store.js';

import type { CommandError } from './command-error.js';
import { deleteObjectsCommand, type DeleteObjectsResult } from './delete-objects.js';
import { runCommand, type CommandEnvironment } from './run-command.js';
import { writtenSinceCreation } from './written-since-creation.js';

/** What {@link liftOff} did. */
export interface LiftOffOutcome {
  /**
   * `applied`: one `deleteObjects` ran; `nothing`: every object was kept or gone, so nothing
   * ran; `rejected`: the delete was refused and nothing changed.
   */
  readonly status: 'applied' | 'nothing' | 'rejected';
  /** The objects asked for that were deleted, sorted. */
  readonly liftedIds: readonly ObjectId[];
  /** The objects asked for that stay, because someone else's work is in or on them, sorted. */
  readonly keptIds: readonly ObjectId[];
  /** What the delete returned, when it ran. */
  readonly result?: DeleteObjectsResult;
  /** Why the delete was refused, when it was. */
  readonly errors?: readonly CommandError[];
}

/**
 * Which of the candidates stay: those written to since their creation by someone other than
 * their creator ({@link writtenSinceCreation}), those holding a child that is not lifted (a
 * person's sticky put in the agent's frame), those a connector or comment that is not lifted
 * refers to (deleting them would write to it), and, up the tree, each candidate holding one
 * that stays, so a kept object is never deleted with its parent. Reads only.
 *
 * @param store - The board.
 * @param candidates - The objects on the board asked for.
 * @returns The ids that stay.
 */
function keptAmong(store: DocumentStore, candidates: ReadonlySet<ObjectId>): Set<ObjectId> {
  const kept = new Set(writtenSinceCreation(store, [...candidates]));
  const { references } = store;
  const isLifted = (id: ObjectId): boolean => candidates.has(id) && !kept.has(id);
  for (let isChanged = true; isChanged;) {
    isChanged = false;
    for (const id of candidates) {
      if (kept.has(id)) continue;
      const dependents = [
        ...references.childrenOf(id),
        ...references.connectorsAttachedTo(id),
        ...references.commentsAnchoredTo(id),
      ];
      if (dependents.some((dependent) => !isLifted(dependent))) {
        kept.add(id);
        isChanged = true;
      }
    }
  }
  return kept;
}

/**
 * Lifts an agent's trace sheet off the board ("Lift off"): deletes the given objects
 * as one `deleteObjects` command under `origin`, so one undo step in that person's history,
 * except those someone other than their creator has written to since they were created (the
 * Rule; see `keptAmong` for the objects kept with them), which stay so the caller can
 * say so. Objects no longer on the board are neither lifted nor kept. Main thread.
 *
 * @param store - The board, a Yjs document store.
 * @param origin - The person lifting the sheet off.
 * @param ids - The sheet's objects.
 * @param environment - The command clock and id generator.
 * @returns What was lifted and what was kept.
 * @throws {TypeError} When the store is not a Yjs document store.
 */
export function liftOff(
  store: DocumentStore,
  origin: TransactionOrigin,
  ids: readonly ObjectId[],
  environment: CommandEnvironment,
): LiftOffOutcome {
  const candidates = new Set(ids.filter((id) => store.get(id) !== undefined));
  const kept = keptAmong(store, candidates);
  const liftedIds = [...candidates].filter((id) => !kept.has(id)).sort();
  const keptIds = [...kept].sort();
  if (liftedIds.length === 0) return { status: 'nothing', liftedIds, keptIds };
  const outcome = runCommand(store, origin, deleteObjectsCommand, { ids: liftedIds }, environment);
  if (outcome.status === 'rejected') {
    return { status: 'rejected', liftedIds: [], keptIds, errors: outcome.errors };
  }
  return { status: 'applied', liftedIds, keptIds, result: outcome.result };
}
