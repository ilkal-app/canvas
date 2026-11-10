import type { DocumentCacheBinding } from '../cache/document-cache-binding.js';
import { LayoutCarryOver } from '../cache/layout-carry-over.js';

import type { CollabClientOptions } from './collab-client-options.js';
import type { CollabStatusHolder } from './collab-status-holder.js';

/**
 * The carry-over of the board's earlier-layout copies, when the client has a cache
 * binding and the cache has earlier layouts: carried edits are appended to that cache, and
 * awaited, before an earlier copy is deleted.
 *
 * @param options - The client's options: store, board, cache, converters, `onError`.
 * @param cacheBinding - The store's cache binding.
 * @returns The carry-over, or `undefined`.
 */
export function createLayoutCarryOver(
  options: CollabClientOptions,
  cacheBinding: DocumentCacheBinding | undefined,
): LayoutCarryOver | undefined {
  const { cache, boardId } = options;
  const earlierLayouts = cache?.earlierLayouts;
  if (cache === undefined || cacheBinding === undefined || earlierLayouts === undefined) {
    return undefined;
  }
  return new LayoutCarryOver({
    store: options.store,
    boardId,
    earlierLayouts,
    storeDurably: (update) => cache.append(boardId, update),
    ...(options.layoutConverters === undefined ? {} : { converters: options.layoutConverters }),
    ...(options.onError === undefined ? {} : { onError: options.onError }),
  });
}

/**
 * Reads the board's stored updates from the client's cache, when the client keeps one bound to
 * its store and it can read its log without marking it seen: a large sync step 2
 * replays them. It reads the current writer layout's cache only; the layout carry-over
 * reads the earlier layouts' copies, and appends what it carries to this one.
 *
 * @param options - The client's options: cache and board.
 * @param cacheBinding - The store's cache binding.
 * @returns The reader, or `undefined`.
 */
export function storedUpdatesReader(
  options: CollabClientOptions,
  cacheBinding: DocumentCacheBinding | undefined,
): (() => Promise<readonly Uint8Array[]>) | undefined {
  const { cache, boardId } = options;
  const readUpdates = cache?.readUpdates?.bind(cache);
  if (cacheBinding === undefined || readUpdates === undefined) return undefined;
  return () => readUpdates(boardId);
}

/**
 * Runs the layout carry-over once the first sync is done, when the store holds the relay's
 * board: once per client, never again on a reconnection.
 *
 * @param carryOver - The client's carry-over, if it has one.
 * @param status - The client's status, whose first `connected` starts the carry-over.
 * @returns Stops waiting and destroys the carry-over.
 */
export function carryOverAtFirstSync(
  carryOver: LayoutCarryOver | undefined,
  status: CollabStatusHolder,
): () => void {
  if (carryOver === undefined) return () => undefined;
  const stop = status.subscribe((current) => {
    if (current.state !== 'connected') return;
    stop();
    void carryOver.run(!current.isReadOnly);
  });
  return () => {
    stop();
    carryOver.destroy();
  };
}
