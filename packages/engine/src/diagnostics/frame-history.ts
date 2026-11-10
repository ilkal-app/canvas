import {
  createFrameSample,
  FRAME_COUNTER_NAMES,
  resetFrameSample,
  type FrameCounters,
  type FrameSample,
  type WritableFrameSample,
} from './frame-sample.js';
import { MEMORY_CATEGORIES } from './memory-ledger.js';
import { RingBuffer } from './ring-buffer.js';

/** Frames a {@link FrameHistory} keeps by default: four seconds at 60 Hz. */
export const DEFAULT_FRAME_HISTORY_CAPACITY = 240;

/**
 * The last N frames the stage timers measured, oldest first, plus the names that index each
 * sample's per-stage and per-pass arrays. The developer overlay and the
 * benchmark export (`createBenchmarkSample`) read it; the stage timers write it through
 * `beginSample` and `commitSample`. Slots are reused, so a steady frame allocates nothing; a
 * stage name or pass label seen for the first time is the only thing that grows it. Beside the
 * kept frames it keeps a running count, maximum of each counter and memory peak over the whole
 * run, however many frames that is, until {@link FrameHistory.clear}. Owned by the thread that
 * runs the frame.
 */
export class FrameHistory {
  private readonly ring: RingBuffer<WritableFrameSample>;
  private readonly stages: string[] = [];
  private readonly passes: string[] = [];
  private readonly stageIndexByName = new Map<string, number>();
  private readonly passIndexByLabel = new Map<string, number>();
  private readonly max: Record<keyof FrameCounters, number> = zeroCounters();
  private readonly peakMemoryBytes: number[] = MEMORY_CATEGORIES.map(() => 0);
  private committedFrames = 0;

  /**
   * Creates an empty history with every slot allocated.
   *
   * @param capacity - How many frames to keep; default {@link DEFAULT_FRAME_HISTORY_CAPACITY}.
   * @throws {RangeError} When the capacity is not a positive integer.
   */
  constructor(capacity: number = DEFAULT_FRAME_HISTORY_CAPACITY) {
    this.ring = new RingBuffer(capacity, createFrameSample);
  }

  /**
   * How many frames the history keeps.
   *
   * @returns The capacity in frames.
   */
  get capacity(): number {
    return this.ring.capacity;
  }

  /**
   * How many frames it holds now.
   *
   * @returns The frame count, at most the capacity.
   */
  get size(): number {
    return this.ring.size;
  }

  /**
   * The latest committed frame.
   *
   * @returns Its sample, or `undefined` before the first frame.
   */
  get newest(): FrameSample | undefined {
    return this.ring.newest;
  }

  /**
   * Frames committed since the history was created or cleared, including those no longer kept.
   *
   * @returns The frame count.
   */
  get runFrames(): number {
    return this.committedFrames;
  }

  /**
   * The largest value of each counter over the run; zeros before the first frame.
   *
   * @returns The maxima, a live view.
   */
  get runMax(): FrameCounters {
    return this.max;
  }

  /**
   * The most GPU bytes of each memory category at the end of any frame of the run.
   *
   * @returns One byte count per `MEMORY_CATEGORIES` entry, a live view.
   */
  get runPeakMemoryBytes(): readonly number[] {
    return this.peakMemoryBytes;
  }

  /**
   * Every stage name seen, in first-seen order: the index of `FrameSample.stageMs`.
   *
   * @returns The names.
   */
  get stageNames(): readonly string[] {
    return this.stages;
  }

  /**
   * Every timed pass label seen, in first-seen order: the index of `FrameSample.passGpuMs`.
   *
   * @returns The labels.
   */
  get passLabels(): readonly string[] {
    return this.passes;
  }

  /**
   * A frame by age.
   *
   * @param index - 0 for the oldest frame kept, `size - 1` for the newest.
   * @returns Its sample.
   * @throws {RangeError} When the index is outside `[0, size)`.
   */
  at(index: number): FrameSample {
    return this.ring.at(index);
  }

  /**
   * Starts recording a frame into the next slot, blanked; the stage timers call it. The frame
   * is not part of the history until {@link FrameHistory.commitSample}.
   *
   * @param frameIndex - The frame's sequence number.
   * @param timeMs - The frame's timestamp, in ms.
   * @returns The slot to fill.
   */
  beginSample(frameIndex: number, timeMs: number): WritableFrameSample {
    const sample = this.ring.acquire();
    resetFrameSample(sample, frameIndex, timeMs);
    return sample;
  }

  /**
   * Adds the begun frame as the newest, dropping the oldest when full, and folds it into the
   * run's count, maxima and memory peaks.
   */
  commitSample(): void {
    const sample = this.ring.acquire();
    this.committedFrames += 1;
    for (const name of FRAME_COUNTER_NAMES) {
      // `>` is false for NaN, so a frame without a CPU time leaves the maximum alone.
      if (sample[name] > this.max[name]) this.max[name] = sample[name];
    }
    for (let index = 0; index < this.peakMemoryBytes.length; index += 1) {
      const bytes = sample.memoryBytes[index] ?? 0;
      if (bytes > (this.peakMemoryBytes[index] ?? 0)) this.peakMemoryBytes[index] = bytes;
    }
    this.ring.commit();
  }

  /**
   * The slot of a committed frame still in the history, for GPU timings that resolve after the
   * frame was committed.
   *
   * @param frameIndex - The frame's sequence number.
   * @returns Its slot, or `undefined` once it has been overwritten.
   */
  findByFrameIndex(frameIndex: number): WritableFrameSample | undefined {
    for (let index = this.ring.size - 1; index >= 0; index -= 1) {
      const sample = this.ring.at(index);
      if (sample.frameIndex === frameIndex) return sample;
    }
    return undefined;
  }

  /**
   * The index of a stage name in `FrameSample.stageMs`, numbering a new name.
   *
   * @param name - The stage's name.
   * @returns Its index.
   */
  stageIndexOf(name: string): number {
    return indexOf(name, this.stages, this.stageIndexByName);
  }

  /**
   * The index of a pass label in `FrameSample.passGpuMs`, numbering a new label.
   *
   * @param label - The pass's timing label.
   * @returns Its index.
   */
  passIndexOf(label: string): number {
    return indexOf(label, this.passes, this.passIndexByLabel);
  }

  /**
   * Forgets every frame and starts a new run (count, maxima and peaks to zero), as before a
   * benchmark scenario; stage names and pass labels stay numbered.
   */
  clear(): void {
    this.ring.clear();
    this.committedFrames = 0;
    for (const name of FRAME_COUNTER_NAMES) this.max[name] = 0;
    this.peakMemoryBytes.fill(0);
  }
}

function zeroCounters(): Record<keyof FrameCounters, number> {
  return {
    cpuMs: 0,
    pastBudgetMs: 0,
    drawCalls: 0,
    uploadedBytes: 0,
    bufferWrites: 0,
    changedObjects: 0,
    visibleRecords: 0,
    blankImages: 0,
    placeholderImages: 0,
    visibleImages: 0,
    segments: 0,
    lodTransitions: 0,
    lodThrashes: 0,
    atlasRegenerations: 0,
    atlasLookups: 0,
    atlasMisses: 0,
    meshRegenerations: 0,
    vectorTextRuns: 0,
    layersDrawn: 0,
    layersFallbackSmall: 0,
    layersFallbackLimit: 0,
    layersFallbackBudget: 0,
    layerBytes: 0,
    renderPasses: 0,
    pipelineSwitches: 0,
    bindGroupChanges: 0,
  };
}

function indexOf(name: string, names: string[], indexByName: Map<string, number>): number {
  let index = indexByName.get(name);
  if (index === undefined) {
    index = names.length;
    names.push(name);
    indexByName.set(name, index);
  }
  return index;
}
