import { describe, expect, it } from 'vitest';

import { DEFAULT_FRAME_HISTORY_CAPACITY, FrameHistory } from './frame-history.js';

function record(history: FrameHistory, frameIndex: number, cpuMs: number): void {
  const sample = history.beginSample(frameIndex, frameIndex * 16);
  sample.cpuMs = cpuMs;
  history.commitSample();
}

describe('FrameHistory', () => {
  it('keeps four seconds of 60 Hz frames by default', () => {
    expect(DEFAULT_FRAME_HISTORY_CAPACITY).toBe(240);
    expect(new FrameHistory().capacity).toBe(240);
  });

  it('keeps the last capacity frames, oldest first', () => {
    const history = new FrameHistory(2);
    record(history, 0, 1);
    record(history, 1, 2);
    record(history, 2, 3);
    expect(history.size).toBe(2);
    expect([history.at(0).frameIndex, history.at(1).frameIndex]).toEqual([1, 2]);
    expect(history.newest?.cpuMs).toBe(3);
  });

  it('starts a sample blank: counters zero and every measurement NaN', () => {
    const history = new FrameHistory(1);
    const first = history.beginSample(0, 0);
    first.stageMs.push(4);
    first.passGpuMs.push(2);
    first.drawCalls = 9;
    first.cpuMs = 5;
    history.commitSample();
    record(history, 1, 1);
    const reused = history.beginSample(2, 32);
    expect(reused).toBe(first);
    expect(reused).toMatchObject({ frameIndex: 2, timeMs: 32, drawCalls: 0, visibleRecords: 0 });
    expect(reused.cpuMs).toBeNaN();
    expect(reused.stageMs.every(Number.isNaN)).toBe(true);
    expect(reused.passGpuMs.every(Number.isNaN)).toBe(true);
    expect(reused.memoryBytes).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('does not show a begun sample until it is committed', () => {
    const history = new FrameHistory(4);
    history.beginSample(0, 0);
    expect(history.size).toBe(0);
    expect(history.newest).toBeUndefined();
  });

  it('numbers stage names and pass labels in the order they first appear', () => {
    const history = new FrameHistory();
    expect(history.stageIndexOf('collectChanges')).toBe(0);
    expect(history.stageIndexOf('draw')).toBe(1);
    expect(history.stageIndexOf('collectChanges')).toBe(0);
    expect(history.passIndexOf('scene')).toBe(0);
    expect(history.stageNames).toEqual(['collectChanges', 'draw']);
    expect(history.passLabels).toEqual(['scene']);
  });

  it('finds a committed frame by its index, for GPU timings that resolve later', () => {
    const history = new FrameHistory(2);
    record(history, 10, 1);
    record(history, 11, 2);
    expect(history.findByFrameIndex(10)?.cpuMs).toBe(1);
    record(history, 12, 3);
    expect(history.findByFrameIndex(10)).toBeUndefined();
    history.beginSample(13, 0);
    expect(history.findByFrameIndex(13)).toBeUndefined();
  });

  it('forgets every frame but keeps the names it has seen', () => {
    const history = new FrameHistory(2);
    history.stageIndexOf('draw');
    record(history, 0, 1);
    history.clear();
    expect(history.size).toBe(0);
    expect(history.stageNames).toEqual(['draw']);
  });

  it('keeps the whole run maxima and memory peaks past frames it no longer holds', () => {
    const history = new FrameHistory(2);
    const spike = history.beginSample(0, 0);
    spike.cpuMs = 40;
    spike.drawCalls = 9;
    spike.memoryBytes[2] = 5000;
    history.commitSample();
    for (let frameIndex = 1; frameIndex < 6; frameIndex += 1) {
      const sample = history.beginSample(frameIndex, frameIndex * 16);
      sample.cpuMs = 2;
      sample.drawCalls = 3;
      sample.visibleRecords = 100;
      sample.memoryBytes[2] = 1000;
      history.commitSample();
    }
    expect(history.size).toBe(2);
    expect(history.runFrames).toBe(6);
    expect(history.runMax).toMatchObject({ cpuMs: 40, drawCalls: 9, visibleRecords: 100 });
    expect(history.runPeakMemoryBytes).toEqual([0, 0, 5000, 0, 0, 0]);
  });

  it('leaves the run untouched by a frame that is begun but never committed', () => {
    const history = new FrameHistory(2);
    history.beginSample(0, 0).cpuMs = 99;
    expect(history.runFrames).toBe(0);
    expect(history.runMax.cpuMs).toBe(0);
  });

  it('starts a new run when cleared', () => {
    const history = new FrameHistory(2);
    record(history, 0, 30);
    history.clear();
    expect(history.runFrames).toBe(0);
    expect(history.runMax.cpuMs).toBe(0);
    expect(history.runPeakMemoryBytes).toEqual([0, 0, 0, 0, 0, 0]);
    record(history, 1, 2);
    expect(history.runMax.cpuMs).toBe(2);
  });
});
