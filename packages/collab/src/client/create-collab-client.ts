import { DocumentVersionError, UPDATE_DEPTH_REASON, UpdateDepthError } from '@canvas/document';

import { CacheRecovery } from '../cache/cache-recovery.js';
import { CacheRestoreVersionError } from '../cache/cache-restore-version-error.js';
import { DocumentCacheBinding } from '../cache/document-cache-binding.js';
import { reportAsynchronously } from '../errors/report-asynchronously.js';

import type { CollabClientOptions } from './collab-client-options.js';
import { CollabClient } from './collab-client.js';
import { repairModeFor } from './repair-mode-for.js';
import { createTokenSource, readBoardTokenFor } from './token-source.js';

/**
 * Creates the sync client of one board. It fetches the first
 * token (from `getToken`, or the fixed `token`), whose claims give the client its identity; the
 * cached board, when a cache is given, is loaded into the store before the first connection
 * opens, so the app can paint it while the network answers; the client then connects with that
 * token, resyncs by state vector, and keeps the cache up to date. A cache that cannot be read is
 * reported to `onError` and the client connects without it: the relay holds the board.
 * Over-depth cache values instead stop the client before connecting, preserving those bytes.
 *
 * @param options - The store, board, relay URL, token or token provider, and optional cache,
 *   presence and injected time, transport and network.
 * @returns The client, connecting (or offline, when the device is).
 * @throws {RangeError} When the options give neither or both of `token` and `getToken`, or the
 *   first token is not a board token or opens another board.
 * @throws {Error} Whatever the provider rejects the first token with.
 */
export async function createCollabClient(options: CollabClientOptions): Promise<CollabClient> {
  const tokens = createTokenSource(options);
  const token = await tokens.next();
  const claims = readBoardTokenFor(token, options.boardId);
  options.store.setRepairMode(repairModeFor(claims));
  let rejectionReason: string | undefined;
  let recovery: CacheRecovery | undefined;
  let cacheBinding: DocumentCacheBinding | undefined;
  if (options.cache !== undefined) {
    const bindingOptions = {
      store: options.store,
      cache: options.cache,
      boardId: options.boardId,
      ...(options.prepareSnapshotPreview === undefined
        ? {}
        : { prepareSnapshotPreview: options.prepareSnapshotPreview }),
      ...(options.compactEvery === undefined ? {} : { compactEvery: options.compactEvery }),
      ...(options.idleScheduler === undefined ? {} : { idleScheduler: options.idleScheduler }),
      ...(options.yieldToBrowser === undefined ? {} : { yieldToBrowser: options.yieldToBrowser }),
      ...(options.onError === undefined ? {} : { onError: options.onError }),
    };
    let isReplacementRequired = false;
    try {
      cacheBinding = await DocumentCacheBinding.open(bindingOptions);
    } catch (error: unknown) {
      if (error instanceof DocumentVersionError) {
        if (
          error instanceof CacheRestoreVersionError &&
          error.problem === 'unversioned' &&
          options.cache.recovery !== undefined
        ) {
          await options.cache.append(options.boardId, options.store.encodeState());
          isReplacementRequired = true;
          cacheBinding = DocumentCacheBinding.attach(bindingOptions);
        } else rejectionReason = error.problem;
      } else if (error instanceof UpdateDepthError) rejectionReason = UPDATE_DEPTH_REASON;
      else (options.onError ?? reportAsynchronously)(error);
    }
    if (cacheBinding !== undefined && options.cache.recovery !== undefined) {
      try {
        const retained = await options.cache.recovery.retained(options.boardId);
        if (isReplacementRequired || retained.length > 0)
          recovery = new CacheRecovery({
            ...bindingOptions,
            binding: cacheBinding,
            isReplacementRequired,
            onError: options.onError ?? reportAsynchronously,
          });
      } catch (error: unknown) {
        cacheBinding.destroy();
        throw error;
      }
    }
  }
  return new CollabClient(
    options,
    { claims, token, tokens, rejectionReason, recovery },
    cacheBinding,
  );
}
