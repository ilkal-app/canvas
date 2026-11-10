import type { RecentFrame } from '@canvas/engine';

/** A 60 Hz frame, ms: the height the frame bars measure against. */
export const FRAME_BUDGET_MS = 1000 / 60;

/** One stage's part of a frame bar. */
export interface StageSegment {
  /** The stage's name. */
  readonly stage: string;
  /** Its CPU time in the frame, ms. */
  readonly ms: number;
  /** Its time as a share of the budget: 1 fills a whole budget, more overflows it. */
  readonly fraction: number;
}

/**
 * A frame's bar segments: one per stage that took time, in the frame's stage order,
 * each its share of the budget, unclamped. Pure.
 *
 * @param frame - One of a sample's recent frames.
 * @param budgetMs - What a whole bar stands for, ms.
 * @returns The segments.
 */
export function stageSegments(frame: RecentFrame, budgetMs: number): readonly StageSegment[] {
  return Object.entries(frame.stageMs)
    .filter(([, ms]) => ms > 0)
    .map(([stage, ms]) => ({ stage, ms, fraction: ms / budgetMs }));
}
