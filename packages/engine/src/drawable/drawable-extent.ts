import type { ObjectId, UndrawableReason } from '@canvas/schema';

// The extent a drawn object lies within and the reasons an object is not drawn are the schema's
// (`@canvas/schema`, `drawable/drawable-extent.ts`, part 1), shared with the relay's door
// check of incoming values; the engine re-exports them, and adds what it reports.
export { DRAWABLE_EXTENT, MAX_DRAWABLE_SIZE } from '@canvas/schema';
export type { UndrawableReason } from '@canvas/schema';

/**
 * The most undrawable objects one report lists; `UndrawableReport.count` tells how many there
 * were. A board of 50k hostile objects would otherwise send 50k entries from the engine's thread
 * in one frame report.
 */
export const MAX_REPORTED_UNDRAWABLE = 1_000;

/** An object the engine does not draw, and why (reported once per change, `DrawableGate`). */
export interface UndrawableObject {
  /** The object's id. */
  readonly id: ObjectId;
  /** Why it is not drawn. */
  readonly reason: UndrawableReason;
}

/** The undrawable objects found since the last report: at most `MAX_REPORTED_UNDRAWABLE` listed. */
export interface UndrawableReport {
  /** The first objects found, each once, in the order found. */
  readonly objects: readonly UndrawableObject[];
  /** How many were found, listed or not. */
  readonly count: number;
}
