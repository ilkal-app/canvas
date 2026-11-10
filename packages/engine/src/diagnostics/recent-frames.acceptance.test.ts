import { describe, expect, it } from 'vitest';

import { FrameHistory } from './frame-history.js';
import { createBenchmarkSample, RECENT_FRAME_COUNT } from './stats-export.js';

function recordFrame(history: FrameHistory, frameIndex: number): void {
  const frame = history.beginSample(frameIndex, frameIndex * 16);
  frame.cpuMs = frameIndex + 0.5;
  frame.stageMs[history.stageIndexOf('draw')] = frameIndex / 10;
  frame.stageMs[history.stageIndexOf('collect')] = frameIndex === 2 ? Number.NaN : 0.25;
  frame.drawCalls = frameIndex + 1;
  frame.segments = frameIndex + 2;
  frame.visibleRecords = frameIndex + 3;
  frame.renderPasses = frameIndex + 4;
  frame.pipelineSwitches = frameIndex + 5;
  frame.pastBudgetMs = frameIndex / 4;
  history.commitSample();
}

describe('recent frames in a benchmark sample', () => {
  it('exports the newest 60 frames in history order, with their measured stages and counters', () => {
    const history = new FrameHistory(RECENT_FRAME_COUNT + 5);
    for (let index = 0; index < RECENT_FRAME_COUNT + 7; index += 1) recordFrame(history, index);

    const sample = createBenchmarkSample(history);
    expect(sample.recentFrames).toHaveLength(RECENT_FRAME_COUNT);
    expect(sample.recentFrames.map((frame) => frame.frameIndex)).toEqual(
      Array.from({ length: RECENT_FRAME_COUNT }, (unused, index) => index + 7),
    );
    expect(sample.recentFrames[0]).toEqual({
      frameIndex: 7,
      cpuMs: 7.5,
      stageMs: { draw: 0.7, collect: 0.25 },
      drawCalls: 8,
      segments: 9,
      visibleRecords: 10,
      renderPasses: 11,
      pipelineSwitches: 12,
      pastBudgetMs: 1.75,
    });
    expect(Object.keys(sample.recentFrames[0]?.stageMs ?? {})).toEqual(['draw', 'collect']);
    expect(sample.recentFrames.at(-1)?.frameIndex).toBe(RECENT_FRAME_COUNT + 6);
    expect(sample.frames).toBe(RECENT_FRAME_COUNT + 5);
    expect(sample.runFrames).toBe(RECENT_FRAME_COUNT + 7);
  });

  it('omits a stage that was not measured in a frame and respects a smaller history capacity', () => {
    const history = new FrameHistory(3);
    for (let index = 0; index < 5; index += 1) recordFrame(history, index);

    const recent = createBenchmarkSample(history).recentFrames;
    expect(recent.map((frame) => frame.frameIndex)).toEqual([2, 3, 4]);
    expect(recent[0]?.stageMs).toEqual({ draw: 0.2 });
    expect(recent[1]?.stageMs).toEqual({ draw: 0.3, collect: 0.25 });
  });

  it('exports no recent frames from an empty history', () => {
    expect(createBenchmarkSample(new FrameHistory()).recentFrames).toEqual([]);
  });
});
