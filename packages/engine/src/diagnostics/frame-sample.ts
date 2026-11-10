import { MEMORY_CATEGORIES } from './memory-ledger.js';

/**
 * The per-frame counters, one number each: a frame's own values in a {@link FrameSample}, and a
 * percentile or maximum of them across frames in a `BenchmarkSample`.
 */
export interface FrameCounters {
  /** CPU time of the frame, first stage start to last stage end, in ms. */
  readonly cpuMs: number;
  /**
   * How far `cpuMs` went past the frame budget (`StageTimersOptions.frameBudgetMs`), in
   * ms; 0 for a frame within it.
   */
  readonly pastBudgetMs: number;
  /** `draw` calls. */
  readonly drawCalls: number;
  /** Bytes uploaded with `writeBuffer`. */
  readonly uploadedBytes: number;
  /** `writeBuffer` calls. */
  readonly bufferWrites: number;
  /** Objects the scene rewrote or removed. */
  readonly changedObjects: number;
  /** Instance records the draw list covered. */
  readonly visibleRecords: number;
  /** Visible images of ready assets drawn without a texture (always 0: images never blank). */
  readonly blankImages: number;
  /** Visible images drawn from their placeholder because nothing of their asset ever loaded. */
  readonly placeholderImages: number;
  /** Visible image objects. */
  readonly visibleImages: number;
  /** Z-order segments the draw list formed. */
  readonly segments: number;
  /** Objects whose level-of-detail form changed. */
  readonly lodTransitions: number;
  /** Objects that changed form across a threshold more often than they traversed its band, plus one (thrash: always 0). */
  readonly lodThrashes: number;
  /** Glyphs generated again within a sweep of their eviction (always 0). */
  readonly atlasRegenerations: number;
  /**
   * Glyph lookups the text passes made for text drawn in glyphs: one per glyph each time
   * a text's records are built, lookups replayed for a layout shared within the frame included.
   */
  readonly atlasLookups: number;
  /** Of the {@link FrameCounters.atlasLookups}, those that did not find the glyph at the tier wanted. */
  readonly atlasMisses: number;
  /** Path meshes built again within a sweep of their eviction (always 0). */
  readonly meshRegenerations: number;
  /** Text runs drawn from their glyphs' outlines, above 512 device px per em. */
  readonly vectorTextRuns: number;
  /** Layers composited through offscreen targets. */
  readonly layersDrawn: number;
  /** Layers drawn in the multiply form for being under 64 device pixels. */
  readonly layersFallbackSmall: number;
  /** Layers drawn in the multiply form past the per-frame limit of 16. */
  readonly layersFallbackLimit: number;
  /** Layers drawn in the multiply form to stay inside the layers budget. */
  readonly layersFallbackBudget: number;
  /** Bytes the layers hold: targets, uniforms and the shared scratch. */
  readonly layerBytes: number;
  /** Render passes the backend began. */
  readonly renderPasses: number;
  /** Pipelines it bound, redundant binds skipped where it skips them. */
  readonly pipelineSwitches: number;
  /** Bind groups it bound, likewise. */
  readonly bindGroupChanges: number;
}

/** The names of the {@link FrameCounters}, in report order. */
export const FRAME_COUNTER_NAMES: readonly (keyof FrameCounters)[] = [
  'cpuMs',
  'pastBudgetMs',
  'drawCalls',
  'uploadedBytes',
  'bufferWrites',
  'changedObjects',
  'visibleRecords',
  'blankImages',
  'placeholderImages',
  'visibleImages',
  'segments',
  'lodTransitions',
  'lodThrashes',
  'atlasRegenerations',
  'atlasLookups',
  'atlasMisses',
  'meshRegenerations',
  'vectorTextRuns',
  'layersDrawn',
  'layersFallbackSmall',
  'layersFallbackLimit',
  'layersFallbackBudget',
  'layerBytes',
  'renderPasses',
  'pipelineSwitches',
  'bindGroupChanges',
];

/**
 * What the stage timers measured in one frame: CPU
 * time per stage, GPU time per timed pass, the frame's counters and GPU memory by category. A
 * sample is a slot of the `FrameHistory` ring, rewritten in place by a later frame, so
 * read it when you need it and copy what you keep. Times are in ms, sizes in bytes.
 */
export interface FrameSample extends FrameCounters {
  /** The frame's sequence number, `FrameContext.frameIndex`. */
  readonly frameIndex: number;
  /** The frame's timestamp from the caller (`FrameContext.timeMs`), in ms. */
  readonly timeMs: number;
  /** CPU time from the start of the first stage to the end of the last, in ms. */
  readonly cpuMs: number;
  /**
   * CPU time per stage in ms, indexed like `FrameHistory.stageNames`; NaN for a stage that did
   * not run in this frame.
   */
  readonly stageMs: readonly number[];
  /**
   * GPU time per timed pass in ms, indexed like `FrameHistory.passLabels`; NaN until the
   * backend resolves it, and always NaN without timestamp queries or a `timingLabel`.
   */
  readonly passGpuMs: readonly number[];
  /** GPU memory at the end of the frame, one byte count per `MEMORY_CATEGORIES` entry. */
  readonly memoryBytes: readonly number[];
  /** `draw` calls. */
  readonly drawCalls: number;
  /** Bytes uploaded with `writeBuffer`. */
  readonly uploadedBytes: number;
  /** `writeBuffer` calls. */
  readonly bufferWrites: number;
  /** Objects the scene rewrote or removed. */
  readonly changedObjects: number;
  /**
   * Instance records the draw list covered: the visible objects' records, one per object and
   * pass for today's passes.
   */
  readonly visibleRecords: number;
}

/** A {@link FrameSample} as its writer, the stage timers, sees it. */
export interface WritableFrameSample extends FrameSample {
  /** See {@link FrameSample.frameIndex}. */
  frameIndex: number;
  /** See {@link FrameSample.timeMs}. */
  timeMs: number;
  /** See {@link FrameSample.cpuMs}. */
  cpuMs: number;
  /** See {@link FrameCounters.pastBudgetMs}. */
  pastBudgetMs: number;
  /** See {@link FrameSample.stageMs}. */
  readonly stageMs: number[];
  /** See {@link FrameSample.passGpuMs}. */
  readonly passGpuMs: number[];
  /** See {@link FrameSample.memoryBytes}. */
  readonly memoryBytes: number[];
  /** See {@link FrameSample.drawCalls}. */
  drawCalls: number;
  /** See {@link FrameSample.uploadedBytes}. */
  uploadedBytes: number;
  /** See {@link FrameSample.bufferWrites}. */
  bufferWrites: number;
  /** See {@link FrameSample.changedObjects}. */
  changedObjects: number;
  /** See {@link FrameSample.visibleRecords}. */
  visibleRecords: number;
  /** See {@link FrameCounters.blankImages}. */
  blankImages: number;
  /** See {@link FrameCounters.placeholderImages}. */
  placeholderImages: number;
  /** See {@link FrameCounters.visibleImages}. */
  visibleImages: number;
  /** See {@link FrameCounters.segments}. */
  segments: number;
  /** See {@link FrameCounters.lodTransitions}. */
  lodTransitions: number;
  /** See {@link FrameCounters.lodThrashes}. */
  lodThrashes: number;
  /** See {@link FrameCounters.atlasRegenerations}. */
  atlasRegenerations: number;
  /** See {@link FrameCounters.atlasLookups}. */
  atlasLookups: number;
  /** See {@link FrameCounters.atlasMisses}. */
  atlasMisses: number;
  /** See {@link FrameCounters.meshRegenerations}. */
  meshRegenerations: number;
  /** See {@link FrameCounters.vectorTextRuns}. */
  vectorTextRuns: number;
  /** See {@link FrameCounters.layersDrawn}. */
  layersDrawn: number;
  /** See {@link FrameCounters.layersFallbackSmall}. */
  layersFallbackSmall: number;
  /** See {@link FrameCounters.layersFallbackLimit}. */
  layersFallbackLimit: number;
  /** See {@link FrameCounters.layersFallbackBudget}. */
  layersFallbackBudget: number;
  /** See {@link FrameCounters.layerBytes}. */
  layerBytes: number;
  /** See {@link FrameCounters.renderPasses}. */
  renderPasses: number;
  /** See {@link FrameCounters.pipelineSwitches}. */
  pipelineSwitches: number;
  /** See {@link FrameCounters.bindGroupChanges}. */
  bindGroupChanges: number;
}

/**
 * Creates an empty sample slot; the history creates all of its slots up front.
 *
 * @returns A blank sample.
 */
export function createFrameSample(): WritableFrameSample {
  const sample: WritableFrameSample = {
    frameIndex: -1,
    timeMs: 0,
    cpuMs: Number.NaN,
    pastBudgetMs: 0,
    stageMs: [],
    passGpuMs: [],
    memoryBytes: MEMORY_CATEGORIES.map(() => 0),
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
  return sample;
}

/**
 * Blanks a reused slot for a new frame, in place and without allocating: counters to zero,
 * measurements to NaN (not measured), memory to zero. Array lengths are kept, so a steady
 * frame never grows them.
 *
 * @param sample - The slot; mutated.
 * @param frameIndex - The new frame's sequence number.
 * @param timeMs - The new frame's timestamp, in ms.
 */
export function resetFrameSample(
  sample: WritableFrameSample,
  frameIndex: number,
  timeMs: number,
): void {
  sample.frameIndex = frameIndex;
  sample.timeMs = timeMs;
  sample.cpuMs = Number.NaN;
  sample.pastBudgetMs = 0;
  sample.stageMs.fill(Number.NaN);
  sample.passGpuMs.fill(Number.NaN);
  sample.memoryBytes.fill(0);
  sample.drawCalls = 0;
  sample.uploadedBytes = 0;
  sample.bufferWrites = 0;
  sample.changedObjects = 0;
  sample.visibleRecords = 0;
  sample.blankImages = 0;
  sample.placeholderImages = 0;
  sample.visibleImages = 0;
  sample.segments = 0;
  sample.lodTransitions = 0;
  sample.lodThrashes = 0;
  sample.atlasRegenerations = 0;
  sample.atlasLookups = 0;
  sample.atlasMisses = 0;
  sample.meshRegenerations = 0;
  sample.vectorTextRuns = 0;
  sample.layersDrawn = 0;
  sample.layersFallbackSmall = 0;
  sample.layersFallbackLimit = 0;
  sample.layersFallbackBudget = 0;
  sample.layerBytes = 0;
  sample.renderPasses = 0;
  sample.pipelineSwitches = 0;
  sample.bindGroupChanges = 0;
}
