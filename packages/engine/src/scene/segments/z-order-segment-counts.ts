/** How often `ZOrderSegments` rebuilt each of its cached tables, since it was created. */
export interface ZOrderSegmentCounts {
  /** Paint-order rebuilds: a `z` key, a parent or the set of objects changed. */
  readonly orderBuilds: number;
  /**
   * How many frames edited the paint order in its middle without walking it (leaf
   * objects created, deleted or moved anywhere).
   */
  readonly orderEdits: number;
  /**
   * Slot-owner rebuilds: the paint order changed. A frame in which only existing objects' record
   * counts changed patches the tables instead (`ZOrderSegments.slotPatchCount`).
   */
  readonly slotBuilds: number;
  /** Full segment plans: table changes or coverage changes that cannot use an interval patch. */
  readonly plans: number;
  /** Records re-slotted in paint order (`SlotCompactor`). */
  readonly slotCompactions: number;
}

/** Incremental planning work since a segment stage was created. */
export interface SegmentRemovalCounts {
  /** Successful interval patches, excluding full planning. */
  readonly patches: number;
  /** Logical slot visits during patches, including affected page extrema scans. */
  readonly slotReads: number;
}
