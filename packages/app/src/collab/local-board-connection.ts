import { DocumentCacheBinding, LayoutCarryOver, type DocumentCache } from '@canvas/collab';
import { YjsDocumentStore } from '@canvas/document';

import { LOCAL_USER_ORIGIN } from '../engine/demo-document.js';
import { disableFontCatalogue } from '../text-input/remote-font-catalogue.js';

import { openBoardCacheOrNone } from './board-cache.js';
import { NO_STRANDED_EDITS, type BoardConnectionStatus } from './board-connection-status.js';
import type { BoardConnection } from './board-connection.js';
import { seedIfNeverWritten } from './board-seed.js';

/** What `createLocalBoardConnection` may be given besides the board id. */
export interface LocalBoardConnectionOptions {
  /**
   * Opens the device's board cache; the IndexedDB one (`canvas-board-cache:layout:<n>` for this
   * build's `DOCUMENT_LAYOUT_VERSION`, keyed by board id, the same the relay path uses) by
   * default, none where there is no IndexedDB.
   */
  readonly openCache?: () => Promise<DocumentCache | undefined>;
  /** Receives a cache that fails to open, read or write; the page's `reportError` by default. */
  readonly onError?: (error: unknown) => void;
  /**
   * Whether a board never written is seeded with the demo board; `true` by default (the
   * playground). The site's boards start empty.
   */
  readonly shouldSeedDemoBoard?: boolean;
  /**
   * Whether the person may only view the board (a viewer's token, or the page's word
   * when no token came): the status says so, the store runs its automatic repairs read-only
   * and edits from an earlier layout are reported, never carried over. False by
   * default.
   */
  readonly isReadOnly?: boolean;
  /**
   * Whether the cache keeps every record uncompacted: set when a relay is configured
   * and this local board is its fallback, since its edits reach the relay the next time the
   * board opens synced, and the collab client replays them transaction by transaction from the
   * log only if no compaction folded them into the snapshot. A board with no relay configured
   * compacts as usual. `false` by default.
   */
  readonly shouldHoldCompaction?: boolean;
  /**
   * Whether the page may offer the font service's catalogue (the font browser's "All fonts", a
   * stored family no bundled font has); `true` by default, from the same-origin route the
   * playground serves or the service a relay board configured. `false` leaves the page with none,
   * so the board makes no request for it (an SDK board).
   */
  readonly hasFontCatalogue?: boolean;
}

/**
 * Reports a failure to the page as an uncaught error would be.
 *
 * @param error - The failure.
 */
function reportToPage(error: unknown): void {
  reportError(error);
}

/**
 * Binds a store to its cached copy, restoring the board into it, or reports why it cannot.
 *
 * @param store - The board's new store.
 * @param cache - The open cache.
 * @param boardId - The board, its key in the cache.
 * @param report - Receives a cache that cannot be read.
 * @returns The binding, or `undefined` when the cache cannot be read.
 */
async function bindOrNone(
  store: YjsDocumentStore,
  cache: DocumentCache,
  boardId: string,
  report: (error: unknown) => void,
): Promise<DocumentCacheBinding | undefined> {
  try {
    return await DocumentCacheBinding.open({ store, cache, boardId, onError: report });
  } catch (error: unknown) {
    report(error);
    return undefined;
  }
}

/**
 * Carries the board's copies from earlier writer layouts into the store: with no relay
 * to compare against, the store restored from the current cache is the reference, and carried
 * edits are stored in the current cache, from which they reach the relay when the board is next
 * opened with one. Runs before a never-written board is seeded, so a board that only lived in an
 * earlier layout's cache is not mistaken for a new one.
 *
 * @param store - The board's store, restored from the cache.
 * @param cache - The open cache, bound to the store (carried edits are appended to it directly
 *   and awaited before an earlier copy is deleted).
 * @param boardId - The board.
 * @param report - Receives failures to read or delete an earlier copy.
 * @param canWrite - Whether the edits may be carried into the store; a viewer's are only
 *   reported.
 * @returns The carry-over once its pass is done, or `undefined` without earlier layouts.
 */
async function carryOverEarlierLayouts(
  store: YjsDocumentStore,
  cache: DocumentCache,
  boardId: string,
  report: (error: unknown) => void,
  canWrite: boolean,
): Promise<LayoutCarryOver | undefined> {
  const { earlierLayouts } = cache;
  if (earlierLayouts === undefined) return undefined;
  const carryOver = new LayoutCarryOver({
    store,
    boardId,
    earlierLayouts,
    storeDurably: (update) => cache.append(boardId, update),
    onError: report,
  });
  await carryOver.run(canWrite);
  return carryOver;
}

/**
 * A board only on this device (no relay configured, or none answered when the page opened):
 * its store is restored from the device's board cache (keyed by the board id, shared with the relay
 * path) and every edit is written back, so edits made offline survive a reload and reach the relay
 * once the board is opened with one. A board never written (no objects, no metadata stamp) is
 * seeded with the demo board unless told not to; a board someone cleared stays empty. Edits an
 * earlier stored layout's build left in its cache are carried over first, or reported until
 * dismissed. Without a cache (no IndexedDB, private browsing, a blocked database) the
 * board lives in memory and the status says it is not saved. Edited as the local user; `offline`
 * and local-only for the connection chip. Main thread.
 *
 * @param boardId - The board the page asked for: the cache key, and the chip's board.
 * @param options - The cache to open and where failures go.
 * @returns The connection, once the cached board is in its store.
 */
export async function createLocalBoardConnection(
  boardId: string,
  options: LocalBoardConnectionOptions = {},
): Promise<BoardConnection> {
  const report = options.onError ?? reportToPage;
  if (options.hasFontCatalogue === false) disableFontCatalogue();
  const cache = await openBoardCacheOrNone(options.openCache, report);
  const store = new YjsDocumentStore();
  const isReadOnly = options.isReadOnly === true;
  if (isReadOnly) store.setRepairMode('read-only');
  const binding = cache === undefined ? undefined : await bindOrNone(store, cache, boardId, report);
  if (binding === undefined) cache?.close();
  if (options.shouldHoldCompaction === true) binding?.holdCompactionWhile(() => true);
  const carryOver =
    cache === undefined || binding === undefined
      ? undefined
      : await carryOverEarlierLayouts(store, cache, boardId, report, !isReadOnly);
  if (options.shouldSeedDemoBoard ?? true) seedIfNeverWritten(store);
  const read = (): BoardConnectionStatus =>
    Object.freeze({
      boardId,
      state: 'offline',
      isLocalOnly: true,
      isSavedOnDevice: binding !== undefined,
      pendingUpdateCount: 0,
      isAcknowledged: false,
      isReadOnly,
      rejectionReason: undefined,
      collaborators: Object.freeze([]),
      strandedEdits: carryOver?.stranded ?? NO_STRANDED_EDITS,
    });
  let status = read();
  const listeners = new Set<() => void>();
  const stop = carryOver?.subscribe(() => {
    status = read();
    for (const listener of [...listeners]) listener();
  });
  return {
    cacheWrites: binding?.writes,
    store,
    origin: LOCAL_USER_ORIGIN,
    status: () => status,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dismissStrandedEdits: (source) => {
      void carryOver?.dismiss(source);
    },
    destroy: () => {
      stop?.();
      carryOver?.destroy();
      listeners.clear();
      binding?.destroy();
      store.destroy();
      if (binding !== undefined) cache?.close();
    },
  };
}
