import type { FrameHistory } from './frame-history.js';
import { FRAME_COUNTER_NAMES, type FrameCounters, type FrameSample } from './frame-sample.js';
import { MEMORY_CATEGORIES, type MemoryCategory } from './memory-ledger.js';
import { percentile, percentilePair, type PercentilePair } from './percentiles.js';
import { recentFramesOf, type RecentFrame } from './recent-frames.js';

export { RECENT_FRAME_COUNT, type RecentFrame } from './recent-frames.js';

/** One memory category's GPU bytes across the frames of a {@link BenchmarkSample}. */
export interface MemoryReading {
  /** Bytes at the newest frame. */
  readonly bytes: number;
  /** The most bytes at the end of any frame of the run (`runFrames`), not only those kept. */
  readonly peakBytes: number;
}

/** A per-frame time's median, 90th and 95th percentiles and maximum, ms. */
export interface FrameWorkSummary extends PercentilePair {
  /** The 90th percentile, ms (text scenarios are judged at p90 and the median). */
  readonly p90: number;
  /** The largest value of any frame covered, ms. */
  readonly max: number;
}

/**
 * The frame statistics as plain JSON-serialisable data: the contract between the engine's stage
 * timers and the benchmark harness, which records one per scripted scenario, compares
 * it with the reference run and fails a metric more than 10% worse. The developer overlay shows the same value. Every time is in ms, every
 * size in bytes, every percentile nearest-rank. Documented in the engine README, "Frame
 * statistics"; a change to this shape is a change to that contract.
 */
export interface BenchmarkSample {
  /**
   * How many frames the percentiles (`stages`, `passes`, `p50`, `p90`, `p95`) cover: the newest
   * `min(runFrames, capacity)`. 0 before the first frame, when every number is 0.
   */
  readonly frames: number;
  /**
   * Frames recorded since the history was created or cleared: the run `max` and `peakBytes`
   * cover. `frames < runFrames` means the percentiles cover only the newest `frames`; size the
   * history's capacity to the scenario for percentiles over all of it.
   */
  readonly runFrames: number;
  /** CPU ms per stage by stage name, over the frames the stage ran in. */
  readonly stages: Readonly<Record<string, PercentilePair>>;
  /**
   * GPU ms per timed pass by timing label, over the frames whose timings have resolved; empty
   * without timestamp queries or a `timingLabel`.
   */
  readonly passes: Readonly<Record<string, PercentilePair>>;
  /** How many frames each pass's GPU time covers: those whose timings resolved, by label. */
  readonly passFrames: Readonly<Record<string, number>>;
  /**
   * The work of each frame, its CPU time plus the GPU time of its passes that resolved, over the
   * frames the percentiles cover: what a frame costs end to end (the budgets: p95
   * frame time under 12 ms, no frame over 33 ms). The CPU time alone where no GPU time resolved.
   */
  readonly frameWorkMs: FrameWorkSummary;
  /** GPU bytes per memory category, newest and peak. */
  readonly memory: Readonly<Record<MemoryCategory, MemoryReading>>;
  /** The median of each frame counter. */
  readonly p50: FrameCounters;
  /** The 90th percentile of each frame counter. */
  readonly p90: FrameCounters;
  /** The 95th percentile of each frame counter. With fewer than 20 frames it is the maximum. */
  readonly p95: FrameCounters;
  /** The maximum of each frame counter over the whole run, however long. */
  readonly max: FrameCounters;
  /**
   * The newest frames one by one, oldest first, at most `RECENT_FRAME_COUNT`: what the frame
   * debug view draws. Empty before the first frame.
   */
  readonly recentFrames: readonly RecentFrame[];
  /**
   * The glyph atlas's hit rate over the frames the percentiles cover: 1 − Σ misses /
   * Σ lookups (`FrameCounters.atlasMisses`, `atlasLookups`). Absent when no frame looked a glyph up.
   */
  readonly atlasHitRate?: number;
}

type CounterName = keyof FrameCounters;

/**
 * Summarises the frames a history holds into a {@link BenchmarkSample}. Pure: reads the history
 * and allocates the result, so call it at the overlay's rate (4 Hz) or once per benchmark run,
 * never per frame.
 *
 * @param history - The stage timers' history (`StageTimers.history`).
 * @returns The summary, safe to `JSON.stringify`.
 */
export function createBenchmarkSample(history: FrameHistory): BenchmarkSample {
  // The benchmark harness (tooling/bench) reads this once per scripted scenario through
  // `EngineHost.readFrameStats`. GPU times are read only here or from the history, never through
  // `collectPassTimings`, which the installed timers own.
  const samples = Array.from({ length: history.size }, (unused, index) => history.at(index));
  return {
    frames: samples.length,
    runFrames: history.runFrames,
    stages: summariseColumns(history.stageNames, samples, (sample) => sample.stageMs),
    passes: summariseColumns(history.passLabels, samples, (sample) => sample.passGpuMs),
    passFrames: countResolved(history.passLabels, samples),
    frameWorkMs: summariseWork(samples),
    memory: summariseMemory(samples.at(-1), history.runPeakMemoryBytes),
    p50: summariseCounters(samples, 0.5),
    p90: summariseCounters(samples, 0.9),
    p95: summariseCounters(samples, 0.95),
    max: { ...history.runMax },
    recentFrames: recentFramesOf(history.stageNames, samples),
    ...atlasHitRateOf(samples),
  };
}

/**
 * The glyph atlas's hit rate over some frames, when any looked a glyph up.
 *
 * @param samples - The frames.
 * @returns `{ atlasHitRate }`, or nothing without a lookup.
 */
function atlasHitRateOf(samples: readonly FrameSample[]): { atlasHitRate?: number } {
  let lookups = 0;
  let misses = 0;
  for (const sample of samples) {
    lookups += sample.atlasLookups;
    misses += sample.atlasMisses;
  }
  return lookups === 0 ? {} : { atlasHitRate: 1 - misses / lookups };
}

/**
 * The p50 and p95 of each named column of per-frame values, skipping frames where a column was
 * not measured (NaN or missing) and columns never measured at all.
 *
 * @param names - The column names, indexing the per-frame arrays.
 * @param samples - The frames.
 * @param columnsOf - A frame's per-column values.
 * @returns The percentiles by column name.
 */
function summariseColumns(
  names: readonly string[],
  samples: readonly FrameSample[],
  columnsOf: (sample: FrameSample) => readonly number[],
): Record<string, PercentilePair> {
  const summary: Record<string, PercentilePair> = {};
  names.forEach((name, index) => {
    const values = samples
      .map((sample) => columnsOf(sample)[index] ?? Number.NaN)
      .filter((value) => !Number.isNaN(value));
    if (values.length > 0) summary[name] = percentilePair(values);
  });
  return summary;
}

/**
 * How many frames resolved each pass's GPU time.
 *
 * @param labels - The pass labels, indexing the per-frame arrays.
 * @param samples - The frames.
 * @returns The count by label, for labels resolved at least once.
 */
function countResolved(
  labels: readonly string[],
  samples: readonly FrameSample[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  labels.forEach((label, index) => {
    const count = samples.filter((sample) => !Number.isNaN(sample.passGpuMs[index] ?? NaN)).length;
    if (count > 0) counts[label] = count;
  });
  return counts;
}

/**
 * Each frame's CPU time plus its resolved GPU time, summarised.
 *
 * @param samples - The frames.
 * @returns p50, p90, p95 and maximum; zeros without frames.
 */
function summariseWork(samples: readonly FrameSample[]): FrameWorkSummary {
  const work = samples
    .filter((sample) => !Number.isNaN(sample.cpuMs))
    .map((sample) =>
      sample.passGpuMs.reduce((sum, ms) => (Number.isNaN(ms) ? sum : sum + ms), sample.cpuMs),
    );
  if (work.length === 0) return { p50: 0, p90: 0, p95: 0, max: 0 };
  return { ...percentilePair(work), p90: percentile(work, 0.9), max: Math.max(...work) };
}

/**
 * Each memory category's bytes at the newest frame and its peak over the run.
 *
 * @param newest - The newest frame, if any.
 * @param peakBytes - The run's peak per category, in category order.
 * @returns The readings in category order.
 */
function summariseMemory(
  newest: FrameSample | undefined,
  peakBytes: readonly number[],
): Record<MemoryCategory, MemoryReading> {
  const entries = MEMORY_CATEGORIES.map((category, index): [MemoryCategory, MemoryReading] => [
    category,
    { bytes: newest?.memoryBytes[index] ?? 0, peakBytes: peakBytes[index] ?? 0 },
  ]);
  return Object.fromEntries(entries) as Record<MemoryCategory, MemoryReading>;
}

/**
 * One percentile of every frame counter.
 *
 * @param samples - The frames.
 * @param fraction - The percentile, 0.5 or 0.95.
 * @returns The counters; all zero when there are no frames.
 */
function summariseCounters(samples: readonly FrameSample[], fraction: number): FrameCounters {
  const entries = FRAME_COUNTER_NAMES.map((name): [CounterName, number] => [
    name,
    samples.length === 0
      ? 0
      : percentile(
          samples.map((sample) => sample[name]),
          fraction,
        ),
  ]);
  return Object.fromEntries(entries) as Record<CounterName, number>;
}
