import { useEffect, useState } from 'react';

import type { BoardReader, ChangeSet } from '@canvas/document';
import { mainClosure, namedSwapTargets, type ObjectId } from '@canvas/schema';

import type { StylePanelSectionProps } from '../panel-sections.js';

/** The objects a section reads for one object of the board, which it follows. */
export type WatchedIdsOf = (board: BoardReader, id: ObjectId) => ReadonlySet<ObjectId>;

/**
 * What an instance's section reads of its main: the main, its descendants, and for
 * each instance among them its own main's the same way, however deep, with every main a record
 * or preset names as a swap target (`mainClosure`), the records of the main's own
 * instances included, so the selected instance's swaps are followed; each main once. Cost: the
 * closure and the main's instances.
 *
 * @param board - The whole board.
 * @param mainId - The main.
 * @returns The ids, those not on the board included when named.
 */
export function mainClosureOf(board: BoardReader, mainId: ObjectId): ReadonlySet<ObjectId> {
  const roots = [mainId];
  for (const id of board.references.instancesOf(mainId)) {
    const instance = board.get(id);
    if (instance !== undefined) roots.push(...namedSwapTargets(instance));
  }
  return mainClosure(
    { get: (id) => board.get(id), childrenOf: (id) => board.references.childrenOf(id) },
    roots,
  );
}

/**
 * What a main's section reads: the main and its instances, wherever they are.
 *
 * @param board - The whole board.
 * @param mainId - The main.
 * @returns The ids.
 */
export function mainAndInstancesOf(board: BoardReader, mainId: ObjectId): ReadonlySet<ObjectId> {
  return new Set([mainId, ...board.references.instancesOf(mainId)]);
}

/**
 * Whether a change set created, updated or deleted any of some objects.
 *
 * @param changes - The change set.
 * @param ids - The objects.
 * @returns True when it touched one.
 */
export function touchesAny(changes: ChangeSet, ids: ReadonlySet<ObjectId>): boolean {
  const { created, updated, deleted } = changes;
  return [created, updated, deleted].some((list) => list.some((id) => ids.has(id)));
}

/**
 * Renders a section again when a change set of the whole board touches what it reads for an
 * object (`watchedOf`), before or after the change, so an object that joined or left counts:
 * the panel's own feed tells only the page shown. Nothing without `watch` or `id`.
 *
 * @param watch - The whole board's change feed (`StylePanelSectionProps.watchDefinitions`).
 * @param board - The whole board, read after each change.
 * @param watchedOf - What the section reads for the object; a stable function.
 * @param id - The object, or undefined for none.
 */
export function useBoardChanges(
  watch: StylePanelSectionProps['watchDefinitions'],
  board: BoardReader,
  watchedOf: WatchedIdsOf,
  id: ObjectId | undefined,
): void {
  const [, setVersion] = useState(0);
  useEffect(() => {
    if (watch === undefined || id === undefined) return undefined;
    let watched = watchedOf(board, id);
    return watch((changes) => {
      const next = watchedOf(board, id);
      const isTouched = touchesAny(changes, watched) || touchesAny(changes, next);
      watched = next;
      if (isTouched) setVersion((version) => version + 1);
    });
  }, [watch, board, watchedOf, id]);
}
