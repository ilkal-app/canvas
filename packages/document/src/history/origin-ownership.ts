import type { PrincipalId } from '@canvas/schema';

import type { TransactionOrigin } from '../origin/transaction-origin.js';

/**
 * Tells whether a transaction's origin belongs to a user's undo history:
 * the user's own changes (`user` origins with the user as principal) and the changes of agents
 * the user operates (`agent` origins with the user as operator). Undo and system changes
 * belong to no history, so an undo step is never captured as a new step, and anything that is
 * not an origin (Yjs starts its own transactions with `null`) belongs to none either.
 *
 * A history may be keyed: a keyed history owns only the agent changes carrying the same
 * {@link TransactionOrigin.historyKey}, and an unkeyed one only changes without a key, so callers
 * sharing one agent connection each undo only their own work.
 *
 * Origins are compared by value: the store hands Yjs a fresh frozen copy of every origin, so
 * identity (Yjs's `trackedOrigins`) cannot tell one principal's transactions from another's.
 *
 * @param origin - A Yjs transaction's origin, usually a {@link TransactionOrigin} the store
 *   issued.
 * @param principalId - The user whose history is being built.
 * @param historyKey - The history's key, or `undefined` for an unkeyed history.
 * @returns `true` when the change is the user's to undo in this history.
 */
export function isOwnedBy(origin: unknown, principalId: PrincipalId, historyKey?: string): boolean {
  if (typeof origin !== 'object' || origin === null) return false;
  const candidate = origin as Partial<TransactionOrigin>;
  if (candidate.historyKey !== historyKey) return false;
  if (candidate.kind === 'user') return candidate.principalId === principalId;
  if (candidate.kind === 'agent') return candidate.operatorId === principalId;
  return false;
}
