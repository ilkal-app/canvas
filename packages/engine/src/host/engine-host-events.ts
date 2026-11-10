import type { EngineFaultListener, EngineFrameListener, EngineFrameReport } from './engine-host.js';
import type { EngineInputsCompleted, EngineInputsCompletedListener } from './input-marks.js';

/**
 * The frame and fault listeners of one engine host, shared by both implementations so they
 * behave alike. Main thread.
 */
export class EngineHostEvents {
  private readonly frameListeners = new Set<EngineFrameListener>();
  private readonly faultListeners = new Set<EngineFaultListener>();
  private readonly completionListeners = new Set<EngineInputsCompletedListener>();

  /**
   * Subscribes to frame reports.
   *
   * @param listener - Called with each report.
   * @returns Unsubscribes.
   */
  onFrame(listener: EngineFrameListener): () => void {
    this.frameListeners.add(listener);
    return () => {
      this.frameListeners.delete(listener);
    };
  }

  /**
   * Subscribes to faults.
   *
   * @param listener - Called with each fault.
   * @returns Unsubscribes.
   */
  onFault(listener: EngineFaultListener): () => void {
    this.faultListeners.add(listener);
    return () => {
      this.faultListeners.delete(listener);
    };
  }

  /**
   * Subscribes to completed input marks.
   *
   * @param listener - Called with each frame's completed marks.
   * @returns Unsubscribes.
   */
  onInputsCompleted(listener: EngineInputsCompletedListener): () => void {
    this.completionListeners.add(listener);
    return () => {
      this.completionListeners.delete(listener);
    };
  }

  /**
   * Hands completed marks to every completion listener.
   *
   * @param completion - The marks, times on the page's clock.
   */
  emitInputsCompleted(completion: EngineInputsCompleted): void {
    for (const listener of [...this.completionListeners]) listener(completion);
  }

  /**
   * Hands a report to every frame listener.
   *
   * @param report - The frame's report.
   */
  emitFrame(report: EngineFrameReport): void {
    for (const listener of [...this.frameListeners]) listener(report);
  }

  /**
   * Hands a fault to every fault listener, or throws it when there is none, so a fault is never
   * silent.
   *
   * @param error - The fault.
   * @throws {Error} `error` itself, when nobody listens.
   */
  emitFault(error: Error): void {
    if (this.faultListeners.size === 0) throw error;
    for (const listener of [...this.faultListeners]) listener(error);
  }
}
