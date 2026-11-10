import type { SnapshotStamp } from './snapshot-stamp.js';
/** Store containing one snapshot per board. */
export const SNAPSHOTS = 'snapshots';
/** Store containing the ordered update tail. */
export const UPDATES = 'updates';
/** Index grouping update records by board. */
export const UPDATES_BY_BOARD = 'by-board';

/** A board's snapshot; `version` grows by one per compaction, so connections see a new one. */
export interface SnapshotRecord {
  readonly boardId: string;
  readonly version: number;
  /** Missing on pre-recovery records, which belong to generation zero. */
  readonly generation?: number;
  /** Original snapshots remain intact after recovery publication. */
  readonly retained?: readonly RetainedSnapshot[];
  /** Previous physical formats, including future old-tab writes, require manual recovery. */
  readonly previousFormatReplayPolicy?: 'manual';
  readonly bytes: Uint8Array;
  /** Optional opaque display bytes written atomically with this snapshot. */
  readonly preview?: Uint8Array;
  /** What vouches for these bytes on reopen; written with them, never carried over. */
  readonly stamp?: SnapshotStamp;
}

/** One update to store; the store's key generator adds `seq`, unique across connections. */
export interface UpdateRecord {
  /** Missing means generation zero. */
  readonly generation?: number;
  readonly boardId: string;
  readonly bytes: Uint8Array;
}

/** One stored update, with the key the store gave it. */
export interface StoredUpdateRecord extends UpdateRecord {
  readonly seq: number;
}

/** Snapshot of an older generation, including generations that had only a tail. */
export interface RetainedSnapshot {
  /** Explicitly discarded sources remain exportable but never replay automatically. */
  readonly replayPolicy?: 'manual';
  readonly generation: number;
  readonly version: number | undefined;
  readonly bytes: Uint8Array | undefined;
}
