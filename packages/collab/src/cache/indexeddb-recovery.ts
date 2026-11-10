import type { CapturedRecovery } from './document-cache.js';
import type { SnapshotRecord, StoredUpdateRecord } from './indexeddb-records.js';

/**
 * Reads one generation without combining it with other generations' updates.
 *
 * @param snapshot - Active metadata with retained snapshots.
 * @param updates - Ordered records across generations.
 * @param generation - The requested generation.
 * @returns Independent captured bytes and record identities.
 * @throws {Error} When a requested older generation is missing.
 */
export function captureGeneration(
  snapshot: SnapshotRecord | undefined,
  updates: readonly StoredUpdateRecord[],
  generation: number,
): CapturedRecovery {
  const active = snapshot?.generation ?? 0;
  const source =
    generation === active
      ? snapshot
      : snapshot?.retained?.find((item) => item.generation === generation);
  if (generation !== active && source === undefined)
    throw new Error('Cache generation is no longer available.');
  const records = updates.filter((record) => (record.generation ?? 0) === generation);
  return {
    ...(source !== undefined && 'replayPolicy' in source
      ? { replayPolicy: 'manual' as const }
      : {}),
    generation,
    snapshotVersion: source?.version,
    updateKeys: records.map((record) => record.seq),
    board: {
      snapshot: source?.bytes?.slice(),
      updates: records.map((record) => record.bytes.slice()),
      // Only the active snapshot record carries a stamp; a retained one never does.
      ...(source !== undefined && 'stamp' in source ? { snapshotStamp: source.stamp } : {}),
    },
  };
}

/**
 * Refuses publication if either snapshot or active tail changed since capture.
 *
 * @param snapshot - Current active metadata.
 * @param updates - All current update records.
 * @param capture - The candidate source.
 * @returns Whether publication still covers the exact source.
 */
export function matchesCapture(
  snapshot: SnapshotRecord | undefined,
  updates: readonly StoredUpdateRecord[],
  capture: CapturedRecovery,
): boolean {
  const generation = snapshot?.generation ?? 0;
  if (generation !== capture.generation || snapshot?.version !== capture.snapshotVersion)
    return false;
  const keys = updates
    .filter((record) => (record.generation ?? 0) === generation)
    .map((record) => record.seq);
  return (
    keys.length === capture.updateKeys.length &&
    keys.every((key, index) => key === capture.updateKeys[index])
  );
}

/**
 * Creates an active snapshot while preserving every older snapshot and tail reference.
 *
 * @param boardId - The board.
 * @param previous - Previous active metadata.
 * @param bytes - Owned validated candidate bytes.
 * @param replayPolicy - Prevents automatic replay of an explicitly discarded source.
 * @returns The next generation metadata.
 */
export function publishedSnapshot(
  boardId: string,
  previous: SnapshotRecord | undefined,
  bytes: Uint8Array,
  replayPolicy?: 'manual',
): SnapshotRecord {
  const generation = previous?.generation ?? 0;
  return {
    boardId,
    ...(replayPolicy === 'manual' || previous?.previousFormatReplayPolicy === 'manual'
      ? { previousFormatReplayPolicy: 'manual' as const }
      : {}),
    generation: generation + 1,
    version: (previous?.version ?? 0) + 1,
    bytes,
    retained: [
      ...(previous?.retained ?? []),
      {
        generation,
        version: previous?.version,
        bytes: previous?.bytes,
        ...(replayPolicy === undefined ? {} : { replayPolicy }),
      },
    ],
  };
}
