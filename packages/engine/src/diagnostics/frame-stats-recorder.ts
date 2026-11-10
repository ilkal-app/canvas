import type { Frame } from '../scene/frame.js';

import { DEFAULT_FRAME_HISTORY_CAPACITY } from './frame-history.js';
import { installStageTimers, type StageTimersInstallation } from './install-stage-timers.js';
import type { MemoryLedger } from './memory-ledger.js';
import { StageTimers } from './stage-timers.js';
import { createBenchmarkSample, type BenchmarkSample } from './stats-export.js';

/**
 * Records a frame's statistics on demand: stage
 * timers on the frame while recording, none otherwise, so a frame nobody watches pays nothing.
 * What the engine host's `startFrameStats`/`readFrameStats`/`stopFrameStats` and the app's
 * main-thread mount run for the developer overlay and the benchmark harness. Runs on the
 * thread that renders the frame.
 */
export class FrameStatsRecorder {
  private frame: Frame;
  private readonly clock: () => number;
  private readonly ledger: MemoryLedger | undefined;
  private recording: { timers: StageTimers; installation: StageTimersInstallation } | undefined;

  /**
   * Prepares to record a frame; nothing is installed until {@link FrameStatsRecorder.start}.
   *
   * @param frame - The frame to time, fully assembled (a stage inserted while recording runs
   *   untimed until the next start with another capacity).
   * @param clock - The rendering thread's monotonic clock, ms.
   * @param ledger - The ledger GPU memory owners report to, shared with the timers; default a
   *   new one per run, which sees only the scene's own buffers.
   */
  constructor(frame: Frame, clock: () => number, ledger?: MemoryLedger) {
    this.frame = frame;
    this.clock = clock;
    this.ledger = ledger;
  }

  /**
   * Whether stage timers are on the frame.
   *
   * @returns `true` between a start and a stop.
   */
  get isRecording(): boolean {
    return this.recording !== undefined;
  }

  /**
   * Starts a new run: installs stage timers the first time (or again with a history of a new
   * capacity) and empties the history every time, as before a benchmark scenario.
   *
   * @param capacity - Frames the history keeps. Default `DEFAULT_FRAME_HISTORY_CAPACITY` (240).
   * @throws {RangeError} When the capacity is not a positive integer; nothing changes then.
   */
  start(capacity: number = DEFAULT_FRAME_HISTORY_CAPACITY): void {
    const current = this.recording;
    if (current?.timers.history.capacity === capacity) {
      current.timers.history.clear();
      return;
    }
    const timers = new StageTimers({
      clock: this.clock,
      capacity,
      ...(this.ledger === undefined ? {} : { ledger: this.ledger }),
    });
    current?.installation.uninstall();
    this.recording = { timers, installation: installStageTimers(this.frame, timers) };
  }

  /**
   * Summarises the frames recorded since the last start.
   *
   * @returns The summary (`createBenchmarkSample`), plain data.
   * @throws {Error} When not recording.
   */
  read(): BenchmarkSample {
    if (this.recording === undefined) {
      throw new Error('No frame statistics are recorded; call startFrameStats first.');
    }
    return createBenchmarkSample(this.recording.timers.history);
  }

  /**
   * Moves recording to another frame, keeping the run's history: after the engine rebuilt its
   * renderer for a new backend (a lost device).
   *
   * @param frame - The new frame, fully assembled.
   */
  retarget(frame: Frame): void {
    const current = this.recording;
    this.frame = frame;
    if (current === undefined) return;
    this.recording = {
      timers: current.timers,
      installation: installStageTimers(frame, current.timers),
    };
  }

  /** Removes the stage timers and forgets the history; nothing when not recording. */
  stop(): void {
    this.recording?.installation.uninstall();
    this.recording = undefined;
  }
}
