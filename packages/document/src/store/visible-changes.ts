import { SYSTEM_ORIGIN, type TransactionOrigin } from '../origin/transaction-origin.js';

import { sortedIds, type ChangedKeys } from './change-collector.js';
import type { ChangeSet } from './document-store.js';
import type { ObjectReplacement } from './reference-index.js';

/**
 * Adds virtual view changes to the document's raw changed keys. A consumer that mirrors only
 * these ids then sees the same board as a fresh snapshot, including refused cycle repairs.
 *
 * @param keys - Raw document changes.
 * @param replacements - Changes in the readable view, including virtual repair.
 * @param origin - The source transaction's origin.
 * @param isLocal - Whether the source transaction was local.
 * @returns A frozen change set with disjoint, sorted lists.
 */
export function visibleChanges(
  keys: ChangedKeys,
  replacements: readonly ObjectReplacement[],
  origin: TransactionOrigin,
  isLocal: boolean,
): ChangeSet {
  const created = new Set(keys.created);
  const updated = new Set(keys.updated);
  const deleted = new Set(keys.deleted);
  for (const { previous, next } of replacements) {
    const id = next?.id ?? previous?.id;
    if (id === undefined || created.has(id) || updated.has(id) || deleted.has(id)) continue;
    if (previous !== undefined && next === undefined) {
      deleted.add(id);
    } else if (previous === undefined && next !== undefined) {
      created.add(id);
    } else {
      updated.add(id);
    }
  }
  return Object.freeze({
    origin,
    isLocal,
    created: Object.freeze(sortedIds(created)),
    updated: Object.freeze(sortedIds(updated)),
    deleted: Object.freeze(sortedIds(deleted)),
  });
}

/**
 * The change set of a change of the readable view alone (a role change between writing and
 * read-only repair), with the system origin and no document change.
 *
 * @param replacements - Changes in the readable view.
 * @returns A frozen change set.
 */
export function viewTransition(replacements: readonly ObjectReplacement[]): ChangeSet {
  const empty = new Set<string>();
  return visibleChanges(
    { created: empty, updated: empty, deleted: empty },
    replacements,
    SYSTEM_ORIGIN,
    false,
  );
}
