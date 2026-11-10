import { describe, expect, it } from 'vitest';

import { FRAME_RATE_WINDOW_MS, frameRateOf, recordFrameTime } from './frame-rate.js';

/**
 * `count` frame timestamps at a steady `fps`, the newest at `endMs`, oldest first.
 *
 * @param fps - The steady rate.
 * @param count - How many timestamps to produce.
 * @param endMs - The newest timestamp.
 * @returns The timestamps, oldest first.
 */
function steadyFrames(fps: number, count: number, endMs: number): number[] {
  const stepMs = 1000 / fps;
  return Array.from({ length: count }, (unused, index) => endMs - (count - 1 - index) * stepMs);
}

describe('frameRateOf', () => {
  it('shows the same current and low FPS for a steady rate held for 5 seconds', () => {
    const frames = steadyFrames(60, 300, 10_000);
    expect(frameRateOf(frames, 10_000)).toEqual({ currentFps: 60, lowFps: 60 });
  });

  it('says the board is idle when no frame was drawn in the last second', () => {
    const frames = steadyFrames(60, 60, 8_000);
    expect(frameRateOf(frames, 9_500).currentFps).toBe('idle');
  });

  it('says the board is idle when nothing was drawn in the last 5 seconds either', () => {
    const frames = steadyFrames(60, 60, 8_000);
    expect(frameRateOf(frames, 14_000)).toEqual({ currentFps: 'idle', lowFps: 'idle' });
  });

  it('shows a stutter in the low figure once the frame rate has recovered', () => {
    // 60 fps for 4 s, a one-second stall to 15 fps, then 60 fps again: the low figure remembers
    // the stall even after the current figure has recovered.
    const before = steadyFrames(60, 240, 4_000);
    const stall = steadyFrames(15, 15, 5_000);
    const after = steadyFrames(60, 60, 6_000);
    const frames = [...before, ...stall, ...after];
    const reading = frameRateOf(frames, 6_000);
    expect(reading.currentFps).toBe(60);
    expect(reading.lowFps).toBe(15);
  });

  it('ignores an idle stretch instead of reporting it as the low figure', () => {
    // Nothing drawn for the first 3 seconds of the window (a still board), then 60 fps: the low
    // figure reflects only the seconds something was actually drawn.
    const frames = steadyFrames(60, 120, 6_000);
    expect(frameRateOf(frames, 6_000)).toEqual({ currentFps: 60, lowFps: 60 });
  });

  it('reports no reading before any frame has been drawn', () => {
    expect(frameRateOf([], 1_000)).toEqual({ currentFps: 'idle', lowFps: 'idle' });
  });
});

describe('recordFrameTime', () => {
  it('appends a frame time and keeps the rest', () => {
    expect(recordFrameTime([0, 100], 200)).toEqual([0, 100, 200]);
  });

  it('drops frame times older than the window, keeping the newest', () => {
    const windowMs = 5_000;
    const history = recordFrameTime([0, 4_000], 5_100, windowMs);
    // 0 is now older than 5_100 - 5_000 = 100 ms; 4_000 is kept.
    expect(history).toEqual([4_000, 5_100]);
  });

  it('defaults its window to FRAME_RATE_WINDOW_MS', () => {
    expect(FRAME_RATE_WINDOW_MS).toBe(5_000);
    expect(recordFrameTime([0], FRAME_RATE_WINDOW_MS + 1)).toEqual([FRAME_RATE_WINDOW_MS + 1]);
  });
});
