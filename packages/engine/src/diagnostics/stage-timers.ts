import type { GpuBackend, GpuPassTiming } from '../gpu/gpu-backend.js';
import type { DrawListEntry } from '../scene/draw-list.js';
import type { FrameContext, FrameTimerHook } from '../scene/frame-context.js';

import { FrameHistory } from './frame-history.js';
import type { WritableFrameSample } from './frame-sample.js';
import { MemoryLedger } from './memory-ledger.js';
import { reportSceneMemory } from './scene-memory.js';

/** Options for {@link StageTimers}. */
export interface StageTimersOptions {
  /**
   * A monotonic clock in ms: `() => performance.now()` from the host. The engine core reads no
   * clock of its own (Global Constraint 3), so tests pass a fake one.
   */
  readonly clock: () => number;
  /** Frames the history keeps; default `DEFAULT_FRAME_HISTORY_CAPACITY` (240). */
  readonly capacity?: number;
  /** The ledger GPU memory owners report to; default a new one. */
  readonly ledger?: MemoryLedger;
  /**
   * The frame budget `FrameCounters.pastBudgetMs` measures against, ms; default
   * {@link DEFAULT_FRAME_BUDGET_MS}.
   */
  readonly frameBudgetMs?: number;
}

/** The default frame budget for `pastBudgetMs`, ms:'s p99 target on the 50k sweep. */
export const DEFAULT_FRAME_BUDGET_MS = 8;

/**
 * The stage timers: CPU time per stage and per
 * frame from an injected clock, GPU time per timed pass from the backend's timestamp queries,
 * the frame's counters and GPU memory by category, recorded into a {@link FrameHistory}. It is
 * a {@link FrameTimerHook}; `installStageTimers` wraps a frame's stages so the frame calls it,
 * and uninstalling leaves nothing behind. A frame is `beginFrame`, `stageStarted`/`stageEnded`
 * per stage, then `endFrame`; a frame that never ends (a stage threw) leaves no entry. Recording
 * a frame allocates nothing in steady state; with timestamp queries, asking the backend for the
 * frame's pass timings costs one promise per frame. Runs on the thread that owns the backend.
 */
export class StageTimers implements FrameTimerHook {
  /** The frames recorded so far. */
  readonly history: FrameHistory;
  /** Where GPU memory owners report; snapshotted at the end of every frame. */
  readonly ledger: MemoryLedger;
  private readonly clock: () => number;
  private readonly frameBudgetMs: number;
  private open: WritableFrameSample | undefined;
  private frameStartMs = Number.NaN;
  private stageStartMs = 0;
  private lastStageEndMs = Number.NaN;
  /**
   * The frame index whose pass timings `collectPassTimings` will return alone: the one after the
   * last frame that ended, or undefined after an abandoned frame. Starts at 0, a fresh renderer.
   */
  private nextFrameIndex: number | undefined = 0;

  /**
   * Creates the timers with an empty history.
   *
   * @param options - The clock, the history's capacity and the ledger.
   * @throws {RangeError} When the capacity is not a positive integer.
   */
  constructor(options: StageTimersOptions) {
    this.clock = options.clock;
    this.frameBudgetMs = options.frameBudgetMs ?? DEFAULT_FRAME_BUDGET_MS;
    this.history = new FrameHistory(options.capacity);
    this.ledger = options.ledger ?? new MemoryLedger();
  }

  /**
   * Starts recording a frame. An unfinished frame before it is discarded.
   *
   * @param context - The frame's index and timestamp.
   */
  beginFrame(context: Pick<FrameContext, 'frameIndex' | 'timeMs'>): void {
    // An abandoned frame may have submitted passes nobody collected.
    if (this.open) this.nextFrameIndex = undefined;
    this.open = this.history.beginSample(context.frameIndex, context.timeMs);
    this.frameStartMs = Number.NaN;
    this.lastStageEndMs = Number.NaN;
  }

  /**
   * A stage is about to run; ignored outside a frame, where it reads no clock.
   *
   * @param stageName - The stage's name.
   */
  stageStarted(stageName: string): void {
    if (!this.open) return;
    const nowMs = this.clock();
    if (Number.isNaN(this.frameStartMs)) this.frameStartMs = nowMs;
    this.stageStartMs = nowMs;
    // Numbered here rather than when it ends, so a new stage's slot exists before it runs.
    this.history.stageIndexOf(stageName);
  }

  /**
   * A stage has finished, normally or by throwing; its CPU time is recorded.
   *
   * @param stageName - The stage's name.
   */
  stageEnded(stageName: string): void {
    const sample = this.open;
    if (!sample) return;
    const nowMs = this.clock();
    setAt(sample.stageMs, this.history.stageIndexOf(stageName), nowMs - this.stageStartMs);
    this.lastStageEndMs = nowMs;
  }

  /**
   * Finishes the frame: records its CPU time, counters, visible records and GPU memory, commits
   * it to the history, and, when the backend has timestamp queries, asks for the GPU times of
   * the passes it submitted, which are attributed to it when they resolve. When this frame does
   * not directly follow the last one that ended (the timers were just installed or re-installed
   * on a renderer that kept rendering, or the previous frame was abandoned), the backend also
   * holds passes of frames nobody collected: that one collection drains the backlog and is
   * discarded rather than added to this frame. Call after the last stage (after `submit`);
   * ignored outside a frame.
   *
   * @param context - The frame's context.
   */
  endFrame(context: FrameContext): void {
    const sample = this.open;
    if (!sample) return;
    this.open = undefined;
    sample.cpuMs = this.lastStageEndMs - this.frameStartMs;
    sample.pastBudgetMs = Math.max(0, sample.cpuMs - this.frameBudgetMs);
    const { stats } = context;
    sample.drawCalls = stats.drawCalls;
    sample.uploadedBytes = stats.uploadedBytes;
    sample.bufferWrites = stats.bufferWrites;
    sample.changedObjects = stats.changedObjects;
    sample.visibleRecords = countRecords(context.drawList);
    sample.blankImages = stats.blankImages;
    sample.placeholderImages = stats.placeholderImages;
    sample.visibleImages = stats.visibleImages;
    sample.segments = stats.segments;
    sample.lodTransitions = stats.lodTransitions;
    sample.lodThrashes = stats.lodThrashes;
    sample.atlasRegenerations = stats.atlasRegenerations;
    sample.atlasLookups = stats.atlasLookups;
    sample.atlasMisses = stats.atlasMisses;
    sample.meshRegenerations = stats.meshRegenerations;
    sample.vectorTextRuns = stats.vectorTextRuns;
    sample.layersDrawn = stats.layersDrawn;
    sample.layersFallbackSmall = stats.layersFallbackSmall;
    sample.layersFallbackLimit = stats.layersFallbackLimit;
    sample.layersFallbackBudget = stats.layersFallbackBudget;
    sample.layerBytes = stats.layerBytes;
    sample.renderPasses = stats.renderPasses;
    sample.pipelineSwitches = stats.pipelineSwitches;
    sample.bindGroupChanges = stats.bindGroupChanges;
    reportSceneMemory(context, this.ledger);
    this.ledger.copyTotalsInto(sample.memoryBytes);
    this.history.commitSample();
    const isInSequence = context.frameIndex === this.nextFrameIndex;
    this.nextFrameIndex = context.frameIndex + 1;
    if (context.backend.capabilities.hasTimestampQuery) {
      this.collectPassTimings(context.backend, context.frameIndex, isInSequence);
    }
  }

  /**
   * Attributes GPU pass times to a recorded frame; passes sharing a label are added up.
   *
   * @param frameIndex - The frame that submitted the passes.
   * @param timings - Their GPU times, from `GpuBackend.collectPassTimings`.
   * @returns Whether the frame was still in the history to receive them.
   */
  recordPassTimings(frameIndex: number, timings: readonly GpuPassTiming[]): boolean {
    const sample = this.history.findByFrameIndex(frameIndex);
    if (!sample) return false;
    for (const { label, durationMs } of timings) {
      const index = this.history.passIndexOf(label);
      const previousMs = sample.passGpuMs[index] ?? Number.NaN;
      setAt(
        sample.passGpuMs,
        index,
        Number.isNaN(previousMs) ? durationMs : previousMs + durationMs,
      );
    }
    return true;
  }

  private collectPassTimings(backend: GpuBackend, frameIndex: number, isInSequence: boolean): void {
    // Called once per frame, right after `submit`, so each in-sequence call returns exactly this
    // frame's labelled passes; an out-of-sequence call drains a backlog (up to 4 frames on
    // WebGPU, 128 passes on WebGL2) and is ignored. A rejected collection loses that frame's GPU
    // time and nothing else.
    backend.collectPassTimings().then(
      (timings) => {
        if (isInSequence) this.recordPassTimings(frameIndex, timings);
      },
      () => undefined,
    );
  }
}

/**
 * Writes one entry of a sample's per-stage or per-pass array, padding a shorter array with NaN
 * (not measured) first; only a stage or pass seen for the first time grows it.
 *
 * @param values - The array; mutated.
 * @param index - The entry.
 * @param value - Its new value.
 */
function setAt(values: number[], index: number, value: number): void {
  while (values.length < index) values.push(Number.NaN);
  values[index] = value;
}

/**
 * The instance records a draw list covers.
 *
 * @param drawList - The frame's draw list.
 * @returns The sum of its ranges' counts.
 */
function countRecords(drawList: readonly DrawListEntry[]): number {
  let records = 0;
  for (const { ranges } of drawList) {
    for (const { count } of ranges) records += count;
  }
  return records;
}
