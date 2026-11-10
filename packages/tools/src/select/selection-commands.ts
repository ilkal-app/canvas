import {
  deleteObjectsCommand,
  runCommand,
  type CommandEnvironment,
  type DocumentStore,
  type TransactionOrigin,
} from '@canvas/document';
import type { ConnectorDeletePolicy, ObjectId } from '@canvas/schema';

import { enteredScopeIds } from './entered-group.js';
import {
  groupsHoldingLocked,
  transformableIds,
  type SelectionSource,
} from './selection-geometry.js';

/**
 * What select all selects: every unlocked object at the
 * board's root or, inside an entered group, its unlocked children. Pure.
 *
 * @param store - The document.
 * @param document - The document as the select tool reads it.
 * @param enteredGroupId - The innermost entered group, or null at the top level.
 * @returns The ids, in the scope's order.
 */
export function selectAllIdsOf(
  store: DocumentStore,
  document: SelectionSource,
  enteredGroupId: ObjectId | null,
): ObjectId[] {
  const scope = enteredScopeIds(enteredGroupId, document) ?? store.references.childrenOf(null);
  return [...scope].filter((id) => store.get(id)?.locked === false);
}

/**
 * Deletes a selection's movable objects (not locked ones, nor groups holding a locked object,
 *), with their descendants, as one `deleteObjects` command; nothing is written when none is
 * movable. Connectors attached to a deleted object are detached (their ends become free points
 * where they were) or, under the person's `delete` preference, deleted with it; one undo
 * restores both.
 *
 * @param store - The document.
 * @param attribution - Who the command is attributed to, and its clock and ids.
 * @param attribution.origin - Who the command is attributed to.
 * @param attribution.environment - The command clock and id generator.
 * @param ids - The selected ids.
 * @param document - The document as the select tool reads it.
 * @param connectorPolicy - What happens to attached connectors: `detach` (the default) or
 *   `delete`.
 * @returns The selected groups left alone because they hold a locked object, for the caller to
 *   say why.
 */
export function deleteSelectionObjects(
  store: DocumentStore,
  attribution: { readonly origin: TransactionOrigin; readonly environment: CommandEnvironment },
  ids: readonly ObjectId[],
  document: SelectionSource,
  connectorPolicy: ConnectorDeletePolicy = 'detach',
): readonly ObjectId[] {
  const movable = transformableIds(ids, document);
  if (movable.length > 0) {
    const { origin, environment } = attribution;
    const input = { ids: movable, connectorPolicy };
    runCommand(store, origin, deleteObjectsCommand, input, environment);
  }
  return groupsHoldingLocked(ids, document);
}
