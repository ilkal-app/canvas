import type { FrameSample } from './frame-sample.js';

/** How many of the newest frames a `BenchmarkSample` lists one by one. */
export const RECENT_FRAME_COUNT = 60;

/**
 * One recent frame as the frame debug view draws it: its CPU time per stage and the
 * counters that explain it, copied from the stage timers' history (no timers of its own).
 */
export interface RecentFrame {
  /** The frame's sequence number. */
  readonly frameIndex: number;
  /** CPU time from the start of the first stage to the end of the last, ms. */
  readonly cpuMs: number;
  /** CPU ms of each stage measured in this frame, by stage name, in the history's stage order. */
  readonly stageMs: Readonly<Record<string, number>>;
  /** `draw` calls. */
  readonly drawCalls: number;
  /** Z-order draw segments. */
  readonly segments: number;
  /** Instance records the culled frame drew. */
  readonly visibleRecords: number;
  /** Render passes begun. */
  readonly renderPasses: number;
  /** Pipelines bound. */
  readonly pipelineSwitches: number;
  /** CPU ms past the frame budget. */
  readonly pastBudgetMs: number;
}

/**
 * The newest frames of a history, oldest first, at most {@link RECENT_FRAME_COUNT}. Pure.
 *
 * @param stageNames - The history's stage names, indexing each frame's `stageMs`.
 * @param samples - The history's frames, oldest first.
 * @returns The recent frames.
 */
export function recentFramesOf(
  stageNames: readonly string[],
  samples: readonly FrameSample[],
): RecentFrame[] {
  return samples.slice(-RECENT_FRAME_COUNT).map((sample) => {
    const stageMs: Record<string, number> = {};
    stageNames.forEach((name, index) => {
      const ms = sample.stageMs[index];
      if (ms !== undefined && !Number.isNaN(ms)) stageMs[name] = ms;
    });
    return {
      frameIndex: sample.frameIndex,
      cpuMs: sample.cpuMs,
      stageMs,
      drawCalls: sample.drawCalls,
      segments: sample.segments,
      visibleRecords: sample.visibleRecords,
      renderPasses: sample.renderPasses,
      pipelineSwitches: sample.pipelineSwitches,
      pastBudgetMs: sample.pastBudgetMs,
    };
  });
}
