/**
 * How much draw state a backend has set since it was created: render passes begun, and
 * pipelines and bind groups actually bound (a backend that skips redundant binds, as WebGPU's
 * does since, counts only those it makes). Cumulative: the renderer reports each frame's
 * difference (`FrameStats.renderPasses`, `pipelineSwitches`, `bindGroupChanges`).
 */
export interface GpuDrawStateCounts {
  /** Render passes begun, canvas and targets alike. */
  renderPasses: number;
  /** Pipelines bound. */
  pipelineSwitches: number;
  /** Bind groups bound. */
  bindGroupChanges: number;
}

/**
 * Counts at zero, for a new backend.
 *
 * @returns The counts.
 */
export function newDrawStateCounts(): GpuDrawStateCounts {
  return { renderPasses: 0, pipelineSwitches: 0, bindGroupChanges: 0 };
}
