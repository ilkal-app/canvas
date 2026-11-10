import type { CapturedRecovery, DocumentCache, EarlierLayoutCaches } from './document-cache.js';
import type { SnapshotPreviewCache } from './snapshot-preview.js';

/**
 * The earlier writer layouts' copies seen through a prefix, under the same keys as the cache.
 *
 * @param earlier - The earlier layouts.
 * @param prefix - What every key starts with.
 * @returns The prefixed view.
 */
function prefixEarlierLayouts(earlier: EarlierLayoutCaches, prefix: string): EarlierLayoutCaches {
  return {
    writerLayoutVersion: earlier.writerLayoutVersion,
    find: (boardId) => earlier.find(prefix + boardId),
    delete: (boardId, copy) => earlier.delete(prefix + boardId, copy),
  };
}

/**
 * Preserves the snapshot/preview association under the owner's ordinary cache key.
 *
 * @param preview - The optional sidecar capability.
 * @param prefix - What every key starts with.
 * @returns The prefixed sidecar capability.
 */
function prefixSnapshotPreview(
  preview: SnapshotPreviewCache,
  prefix: string,
): SnapshotPreviewCache {
  return {
    read: (boardId) => preview.read(prefix + boardId),
    compact: (boardId, snapshot, bytes, stamp) =>
      preview.compact(prefix + boardId, snapshot, bytes, stamp),
  };
}

/**
 * A view of a {@link DocumentCache} that keeps every board under `prefix + boardId`, so several
 * owners of one storage (the site's signed-in people on one browser) never see each other's
 * boards. Every capability of the cache passes through, optional ones included (the earlier
 * layouts; the log reader, without which a large step 2 after a reload is cut
 * by struct ranges): only the keys change. A plain object, so a caller may spread it. Closing it
 * closes the cache. Main thread or worker, as the cache.
 *
 * @param cache - The cache.
 * @param prefix - What every key starts with; it must not be a prefix of another owner's.
 * @returns The view.
 */
export function prefixDocumentCache(cache: DocumentCache, prefix: string): DocumentCache {
  const recovery = cache.recovery;
  const readUpdates = cache.readUpdates?.bind(cache);
  return {
    ...(recovery === undefined
      ? {}
      : {
          recovery: {
            capture: (boardId: string) => recovery.capture(prefix + boardId),
            publish: (
              boardId: string,
              captured: CapturedRecovery,
              snapshot: Uint8Array,
              replayPolicy?: 'manual',
            ) => recovery.publish(prefix + boardId, captured, snapshot, replayPolicy),
            retained: (boardId: string) => recovery.retained(prefix + boardId),
          },
        }),
    ...(cache.earlierLayouts === undefined
      ? {}
      : { earlierLayouts: prefixEarlierLayouts(cache.earlierLayouts, prefix) }),
    ...(readUpdates === undefined
      ? {}
      : { readUpdates: (boardId: string) => readUpdates(prefix + boardId) }),
    ...(cache.snapshotPreview === undefined
      ? {}
      : { snapshotPreview: prefixSnapshotPreview(cache.snapshotPreview, prefix) }),
    load: (boardId) => cache.load(prefix + boardId),
    append: (boardId, update) => cache.append(prefix + boardId, update),
    compact: (boardId, snapshot, stamp) => cache.compact(prefix + boardId, snapshot, stamp),
    delete: (boardId) => cache.delete(prefix + boardId),
    close: () => {
      cache.close();
    },
  };
}
