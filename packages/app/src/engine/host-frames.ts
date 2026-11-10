import type { EngineFrameReport, EngineHost } from '@canvas/engine';

import { recordFrameTime } from '../diagnostics/frame-rate.js';

import type { EngineDrawingBuffer } from './mounted-engine.js';

/** What a mount keeps of the frames its host drew: the last report, recent times, recording. */
export class HostFrames {
  #last: EngineFrameReport | undefined;
  #times: readonly number[] = [];
  #isMeasuring = false;

  /**
   * Whether frame statistics record.
   *
   * @returns True while they do.
   */
  get isMeasuring(): boolean {
    return this.#isMeasuring;
  }

  /**
   * Keeps a frame's report and its time.
   *
   * @param report - The report.
   */
  follow(report: EngineFrameReport): void {
    this.#last = report;
    this.#times = recordFrameTime(this.#times, report.frameTimeMs);
  }

  /**
   * The drawing buffer the last frame drew into.
   *
   * @returns It, or `undefined` before a frame with a camera.
   */
  drawingBuffer(): EngineDrawingBuffer | undefined {
    const frame = this.#last;
    if (frame?.camera === undefined) return undefined;
    return { ...frame.drawingBuffer, dpr: frame.camera.dpr };
  }

  /**
   * The recent frame times.
   *
   * @returns The times, ms.
   */
  times(): readonly number[] {
    return this.#times;
  }

  /**
   * Starts or stops recording frame statistics.
   *
   * @param isMeasuring - Whether to record.
   * @param host - The host, if it runs.
   */
  measure(isMeasuring: boolean, host: EngineHost | undefined): void {
    this.#isMeasuring = isMeasuring;
    if (isMeasuring) host?.startFrameStats();
    else host?.stopFrameStats();
  }
}
