import type { SnapshotStamp } from './snapshot-stamp.js';

/** Opaque display bytes associated atomically with one current-layout snapshot. */
export interface CachedSnapshotPreview {
  /** The version of the snapshot record containing these bytes. */
  readonly snapshotVersion: number;
  /** An owned copy; the app validates its format, board, layout and render dependencies. */
  readonly bytes: Uint8Array;
}

/**
 * Optional current-layout-only snapshot sidecars. Custom caches without this capability keep
 * ordinary hydration. Preview bytes are never authoritative document state.
 */
export interface SnapshotPreviewCache {
  /**
   * Reads a snapshot's sidecar without marking its snapshot or update tail as seen. Never
   * searches earlier-layout databases or invokes converters. Later hydration still calls load.
   *
   * @param boardId - The board.
   * @returns Owned preview bytes, or undefined when no readable sidecar is stored.
   */
  read(boardId: string): Promise<CachedSnapshotPreview | undefined>;
  /**
   * Atomically stores a snapshot and its opaque sidecar under ordinary compaction CAS and
   * unseen-tail rules. Call in the task that encoded the full snapshot, after preparing and
   * checking the preview against the same immutable store state. Inputs are copied on call.
   *
   * @param boardId - The board.
   * @param snapshot - Full authoritative update bytes, including unresolved content.
   * @param preview - The app's already prepared display projection.
   * @param stamp - Stored with the snapshot, as `DocumentCache.compact` stores it.
   * @returns True when both were stored; false when stale CAS changes neither.
   */
  compact(
    boardId: string,
    snapshot: Uint8Array,
    preview: Uint8Array,
    stamp?: SnapshotStamp,
  ): Promise<boolean>;
}

/** The fields required to read an optional sidecar from a snapshot record. */
export interface PreviewSnapshotRecord {
  /** The snapshot's cache version. */
  readonly version: number;
  /** Its optional opaque sidecar. */
  readonly preview?: Uint8Array;
}

/**
 * Copies a readable sidecar without consulting or changing a connection's seen records.
 *
 * @param record - The current-layout snapshot record.
 * @returns An owned preview, or undefined for absent or malformed sidecar metadata.
 */
export function copySnapshotPreview(
  record: PreviewSnapshotRecord | undefined,
): CachedSnapshotPreview | undefined {
  if (
    record === undefined ||
    !Number.isSafeInteger(record.version) ||
    record.version < 1 ||
    !(record.preview instanceof Uint8Array)
  )
    return undefined;
  return { snapshotVersion: record.version, bytes: new Uint8Array(record.preview) };
}
