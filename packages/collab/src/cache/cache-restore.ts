import * as Y from 'yjs';

import {
  assertUpdateDepth,
  SYSTEM_ORIGIN,
  type ApplyUpdateInStepsOptions,
  type DocumentStore,
} from '@canvas/document';

import type { CachedBoard } from './document-cache.js';

/**
 * Applies cached content to the store without storing it again: the snapshot as one
 * transaction, then the updates after it merged into another. Merging the updates alone is
 * cheap; merging them into a large snapshot costs more than applying the two apart (the restore
 * of `indexeddb-cache.bench.ts`'s 10k-object board averages about 675 ms merged and 410 ms
 * apart). Silent: the binding ignores what it restores, so the store need not encode it for its
 * update listeners; a repair the restore causes still reaches them. The store walks
 * the snapshot's depth itself before changing anything; the updates are walked here, before
 * they are merged.
 *
 * @param store - The board's store.
 * @param content - A snapshot and updates, any of them absent.
 * @throws {unknown} What the depth walk or the store's apply throws.
 */
export function restoreCached(store: DocumentStore, content: CachedBoard): void {
  for (const update of content.updates) assertUpdateDepth(update);
  const tail = mergedTail(content.updates);
  const silently = { isSilent: true };
  if (content.snapshot !== undefined) store.applyUpdate(content.snapshot, SYSTEM_ORIGIN, silently);
  if (tail !== undefined) store.applyUpdate(tail, SYSTEM_ORIGIN, silently);
}

/**
 * `restoreCached` in browser tasks: the snapshot, then the merged tail, each through
 * the store's `applyUpdateInSteps` where it has one, yielding between them. The caller has
 * walked the updates' depth. Between the two applies the store takes other updates, so
 * `restoring` wraps each apply alone: what the store reports outside them is not the cache's.
 *
 * @param store - The board's store.
 * @param content - A snapshot and updates, any of them absent.
 * @param yieldToBrowser - Lets the browser run other tasks.
 * @param restoring - Runs one apply of cached bytes, marking what it reports as restored.
 * @returns Resolves once both are applied.
 * @throws {unknown} What the store's apply throws.
 */
export async function restoreCachedInSteps(
  store: DocumentStore,
  content: CachedBoard,
  yieldToBrowser: () => Promise<void>,
  restoring: (apply: () => Promise<void>) => Promise<void>,
): Promise<void> {
  const tail = mergedTail(content.updates);
  const options: ApplyUpdateInStepsOptions = { isSilent: true, yieldToBrowser };
  const apply = (update: Uint8Array): Promise<void> =>
    restoring(() => {
      if (store.applyUpdateInSteps !== undefined)
        return store.applyUpdateInSteps(update, SYSTEM_ORIGIN, options);
      store.applyUpdate(update, SYSTEM_ORIGIN, options);
      return Promise.resolve();
    });
  if (content.snapshot !== undefined) await apply(content.snapshot);
  if (tail === undefined) return;
  if (content.snapshot !== undefined) await yieldToBrowser();
  await apply(tail);
}

/**
 * A cached board's updates as one update to apply after its snapshot.
 *
 * @param updates - The updates after the snapshot, already depth-checked.
 * @returns Their merge, the one update itself, or undefined for none.
 */
function mergedTail(updates: readonly Uint8Array[]): Uint8Array | undefined {
  const [first, ...rest] = updates;
  if (first === undefined) return undefined;
  return rest.length === 0 ? first : Y.mergeUpdates([first, ...rest]);
}
