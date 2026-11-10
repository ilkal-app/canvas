import type { EngineFrameReport } from './engine-host.js';
import type { EngineInputsCompleted } from './input-marks.js';

/** Where an `EngineRuntime` delivers what its frames did, on its own thread. */
export interface EngineRuntimeCallbacks {
  /**
   * Called after each frame.
   *
   * @param report - The frame's report; `frameTimeMs` is on the runtime's own thread's clock.
   */
  onFrame(report: EngineFrameReport): void;
  /**
   * Called when a frame throws; the frame is not reported and its reads reject.
   *
   * @param error - What the frame threw.
   */
  onFault(error: Error): void;
  /**
   * Called once the GPU finished a frame that carried input marks; never for a frame
   * that threw (its marks wait for the next) or whose completion failed (they are dropped).
   *
   * @param completion - The marks; times on the runtime's own thread's clock.
   */
  onInputsCompleted?(completion: EngineInputsCompleted): void;
}
