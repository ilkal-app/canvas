import type * as Y from 'yjs';

import type { DocumentStore } from '../store/document-store.js';
import type { StoreInternals } from '../store/internal.js';

import { reachesCollectedCopy } from './collected-copies.js';
import type { CreationGuard } from './creation-guard.js';
import type { DefinitionGuard } from './definition-guard.js';
import type { DoorGuard } from './door-guard.js';
import type { UndoStep } from './field-guard.js';
import { isPageRemovalBlocked } from './page-guard.js';

/** What decides the step a history hands Yjs (`handedStep`). */
export interface StepGuards {
  /** The store the history records. */
  readonly store: DocumentStore;
  /** Its internals. */
  readonly internals: StoreInternals;
  /** The creation guard. */
  readonly creation: CreationGuard;
  /** The door guard. */
  readonly door: DoorGuard;
  /** The definition guard. */
  readonly definition: DefinitionGuard;
}

/**
 * What Yjs applies in a step's place: the step without the restores it must not make (another
 * person's work, a value the relay's door refuses), or nothing when the creation guard cannot
 * apply it in part, or when Yjs would throw part-way through it (`collected-copies.ts`);
 * the step is then used up unapplied. Runs in the store's transaction.
 *
 * @param guards - The history's guards and store.
 * @param transaction - The Yjs transaction, inside the store's.
 * @param next - The newest step of the stack being popped.
 * @param isOwnDeletion - Whether a step Yjs sees on the stacks meanwhile deleted an item.
 * @returns The step to hand Yjs, or `null` to use it up unapplied.
 */
export function handedStep(
  guards: StepGuards,
  transaction: Y.Transaction,
  next: UndoStep,
  isOwnDeletion: (id: Y.ID) => boolean,
): UndoStep | null {
  const { creation, internals } = guards;
  const guarded = creation.begin(transaction, next, isOwnDeletion);
  if (guarded === null) return null;
  if (isPageRemovalBlocked(transaction, next, internals, guards.store, creation.hasKept())) {
    return null;
  }
  const step = guards.door.begin(transaction, guarded);
  if (reachesCollectedCopy(transaction, step, internals.objects, isOwnDeletion)) return null;
  guards.definition.begin(transaction, step, creation);
  return step;
}
