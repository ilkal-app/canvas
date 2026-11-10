import { describe, expect, it } from 'vitest';

import { FrameHistory } from './frame-history.js';
import { createBenchmarkSample } from './stats-export.js';

interface FrameSpec {
  readonly cpuMs: number;
  readonly stages: Readonly<Record<string, number>>;
  readonly passes?: Readonly<Record<string, number>>;
  readonly drawCalls?: number;
  readonly textureBytes?: number;
  readonly vectorTextRuns?: number;
}

function historyOf(frames: readonly FrameSpec[], capacity?: number): FrameHistory {
  const history = new FrameHistory(capacity);
  frames.forEach((frame, frameIndex) => {
    const sample = history.beginSample(frameIndex, frameIndex * 16);
    sample.cpuMs = frame.cpuMs;
    for (const [name, ms] of Object.entries(frame.stages)) {
      sample.stageMs[history.stageIndexOf(name)] = ms;
    }
    for (const [label, ms] of Object.entries(frame.passes ?? {})) {
      sample.passGpuMs[history.passIndexOf(label)] = ms;
    }
    sample.drawCalls = frame.drawCalls ?? 0;
    sample.vectorTextRuns = frame.vectorTextRuns ?? 0;
    sample.uploadedBytes = 16;
    sample.visibleRecords = 100;
    sample.memoryBytes[2] = frame.textureBytes ?? 0;
    sample.memoryBytes[4] = 16;
    history.commitSample();
  });
  return history;
}

const TWENTY_FRAMES: FrameSpec[] = Array.from({ length: 20 }, (unused, index) => ({
  cpuMs: index + 1,
  stages: { collectChanges: 0.1, draw: (index + 1) / 2 },
  passes: { scene: 20 - index },
  drawCalls: index % 2 === 0 ? 2 : 4,
  textureBytes: index === 5 ? 9000 : 1000,
}));

describe('createBenchmarkSample', () => {
  it('reports p50 and p95 of the frame counters over every frame kept', () => {
    const sample = createBenchmarkSample(historyOf(TWENTY_FRAMES));
    expect(sample.frames).toBe(20);
    expect(sample.p50).toEqual({
      cpuMs: 10,
      pastBudgetMs: 0,
      drawCalls: 2,
      uploadedBytes: 16,
      bufferWrites: 0,
      changedObjects: 0,
      visibleRecords: 100,
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
    });
    expect(sample.p95.cpuMs).toBe(19);
    expect(sample.p95.drawCalls).toBe(4);
  });

  it('reports CPU ms per stage and GPU ms per pass as p50 and p95', () => {
    const sample = createBenchmarkSample(historyOf(TWENTY_FRAMES));
    expect(sample.stages).toEqual({
      collectChanges: { p50: 0.1, p95: 0.1 },
      draw: { p50: 5, p95: 9.5 },
    });
    expect(sample.passes).toEqual({ scene: { p50: 10, p95: 19 } });
  });

  it('reports each memory category at the newest frame and at its peak', () => {
    const { memory } = createBenchmarkSample(historyOf(TWENTY_FRAMES));
    expect(memory.textures).toEqual({ bytes: 1000, peakBytes: 9000 });
    expect(memory.uniforms).toEqual({ bytes: 16, peakBytes: 16 });
    expect(memory.atlases).toEqual({ bytes: 0, peakBytes: 0 });
    expect(Object.keys(memory)).toEqual([
      'instanceBuffers',
      'atlases',
      'textures',
      'meshes',
      'uniforms',
      'layers',
    ]);
  });

  it('counts a stage only in the frames it ran, and leaves out passes never timed', () => {
    const history = historyOf([
      { cpuMs: 1, stages: { draw: 1 } },
      { cpuMs: 2, stages: { draw: 1, segments: 0.5 }, passes: {} },
    ]);
    history.passIndexOf('overlay');
    const sample = createBenchmarkSample(history);
    expect(sample.stages.segments).toEqual({ p50: 0.5, p95: 0.5 });
    expect(sample.passes).toEqual({});
  });

  it('reports GPU passes from the frames whose timings have resolved', () => {
    const history = historyOf([
      { cpuMs: 1, stages: {}, passes: { scene: 4 } },
      { cpuMs: 1, stages: {}, passes: { scene: 6 } },
      { cpuMs: 1, stages: {} },
    ]);
    expect(createBenchmarkSample(history).passes).toEqual({ scene: { p50: 4, p95: 6 } });
    expect(createBenchmarkSample(history).passFrames).toEqual({ scene: 2 });
  });

  it('reports the CPU time plus the resolved GPU time of each frame as its work', () => {
    const history = historyOf([
      { cpuMs: 1, stages: {}, passes: { scene: 4 } },
      { cpuMs: 2, stages: {}, passes: { scene: 1, text: 2 } },
      { cpuMs: 3, stages: {} },
    ]);
    expect(createBenchmarkSample(history).frameWorkMs).toEqual({ p50: 5, p90: 5, p95: 5, max: 5 });
    const busy = historyOf(TWENTY_FRAMES);
    // Frame i does i + 1 ms of CPU and 20 − i ms of GPU: 21 ms each.
    expect(createBenchmarkSample(busy).frameWorkMs).toEqual({ p50: 21, p90: 21, p95: 21, max: 21 });
  });

  it('leaves unresolved GPU times out of frame work, and untimed frames out of it all', () => {
    const history = historyOf([
      { cpuMs: 2, stages: {}, passes: { scene: Number.NaN } },
      { cpuMs: Number.NaN, stages: {}, passes: { scene: 9 } },
    ]);
    expect(createBenchmarkSample(history).frameWorkMs).toEqual({ p50: 2, p90: 2, p95: 2, max: 2 });
    const untimed = historyOf([{ cpuMs: Number.NaN, stages: {} }]);
    expect(createBenchmarkSample(untimed).frameWorkMs).toEqual({ p50: 0, p90: 0, p95: 0, max: 0 });
  });

  it('is plain data that survives a JSON round trip unchanged', () => {
    const sample = createBenchmarkSample(historyOf(TWENTY_FRAMES));
    expect(JSON.parse(JSON.stringify(sample))).toEqual(sample);
  });

  it('reports zero frames and zero counters before the first frame', () => {
    const sample = createBenchmarkSample(new FrameHistory());
    expect(sample.frames).toBe(0);
    expect(sample.stages).toEqual({});
    expect(sample.passes).toEqual({});
    expect(sample.passFrames).toEqual({});
    expect(sample.frameWorkMs).toEqual({ p50: 0, p90: 0, p95: 0, max: 0 });
    expect(sample.p95).toEqual(sample.p50);
    expect(sample.max).toEqual(sample.p50);
    expect(sample.runFrames).toBe(0);
    expect(sample.p50.cpuMs).toBe(0);
    expect(sample.memory.instanceBuffers).toEqual({ bytes: 0, peakBytes: 0 });
  });

  it('carries the runs drawn from outlines into the sample', () => {
    const frames = [0, 2, 5, 1].map((vectorTextRuns) => ({ cpuMs: 1, stages: {}, vectorTextRuns }));
    const sample = createBenchmarkSample(historyOf(frames));
    expect(sample.max.vectorTextRuns).toBe(5);
    expect(sample.p95.vectorTextRuns).toBe(5);
  });

  it('leaves the history as it was', () => {
    const history = historyOf(TWENTY_FRAMES);
    const before = JSON.stringify(history.at(3));
    createBenchmarkSample(history);
    expect(JSON.stringify(history.at(3))).toBe(before);
    expect(history.size).toBe(20);
  });

  it('reports the whole run maximum of each counter and its frame count', () => {
    const sample = createBenchmarkSample(historyOf(TWENTY_FRAMES));
    expect(sample.runFrames).toBe(20);
    expect(sample.max).toEqual({
      cpuMs: 20,
      pastBudgetMs: 0,
      drawCalls: 4,
      uploadedBytes: 16,
      bufferWrites: 0,
      changedObjects: 0,
      visibleRecords: 100,
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
    });
  });

  it('keeps the max and peak of frames older than the history, and says it truncated', () => {
    const longRun: FrameSpec[] = Array.from({ length: 600 }, (unused, index) => ({
      cpuMs: index === 10 ? 40 : 5,
      stages: { draw: 1 },
      textureBytes: index === 20 ? 9000 : 1000,
    }));
    const sample = createBenchmarkSample(historyOf(longRun, 240));
    expect(sample.frames).toBe(240);
    expect(sample.runFrames).toBe(600);
    expect(sample.p95.cpuMs).toBe(5);
    expect(sample.max.cpuMs).toBe(40);
    expect(sample.memory.textures).toEqual({ bytes: 1000, peakBytes: 9000 });
  });
});
