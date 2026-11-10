import { describe, expect, it } from 'vitest';

import { animationMomentAt } from './gif-timeline.js';

describe('animationMomentAt', () => {
  const durations = [100, 200, 300];

  it('shows each frame for its own duration and says when the next starts', () => {
    expect(animationMomentAt(durations, Infinity, 0)).toEqual({ index: 0, nextChangeMs: 100 });
    expect(animationMomentAt(durations, Infinity, 99.9)).toEqual({ index: 0, nextChangeMs: 100 });
    expect(animationMomentAt(durations, Infinity, 100)).toEqual({ index: 1, nextChangeMs: 300 });
    expect(animationMomentAt(durations, Infinity, 299)).toEqual({ index: 1, nextChangeMs: 300 });
    expect(animationMomentAt(durations, Infinity, 300)).toEqual({ index: 2, nextChangeMs: 600 });
  });

  it('loops forever with Infinity plays, timing later loops from the start', () => {
    expect(animationMomentAt(durations, Infinity, 600)).toEqual({ index: 0, nextChangeMs: 700 });
    expect(animationMomentAt(durations, Infinity, 6_150)).toEqual({
      index: 1,
      nextChangeMs: 6_300,
    });
  });

  it('stops on the last frame after the last play, with nothing more to wait for', () => {
    expect(animationMomentAt(durations, 2, 900)).toEqual({ index: 2, nextChangeMs: undefined });
    expect(animationMomentAt(durations, 2, 1_200)).toEqual({ index: 2, nextChangeMs: undefined });
    expect(animationMomentAt(durations, 2, 60_000)).toEqual({ index: 2, nextChangeMs: undefined });
    expect(animationMomentAt(durations, 1, 450)).toEqual({ index: 2, nextChangeMs: undefined });
  });

  it('shows the first frame before playback starts', () => {
    expect(animationMomentAt(durations, Infinity, -50)).toEqual({ index: 0, nextChangeMs: 100 });
  });

  it('a single frame never changes once its only play is reached', () => {
    expect(animationMomentAt([100], 1, 0)).toEqual({ index: 0, nextChangeMs: undefined });
  });

  it('refuses empty, non-positive and impossible inputs', () => {
    expect(() => animationMomentAt([], 1, 0)).toThrow(RangeError);
    expect(() => animationMomentAt([100, 0], 1, 0)).toThrow(RangeError);
    expect(() => animationMomentAt([100], 0, 0)).toThrow(RangeError);
    expect(() => animationMomentAt([100], 1.5, 0)).toThrow(RangeError);
  });

  it('does not change its input', () => {
    const input = [100, 200];
    animationMomentAt(input, 3, 250);
    expect(input).toEqual([100, 200]);
  });
});
