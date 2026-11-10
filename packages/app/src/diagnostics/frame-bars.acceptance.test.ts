import { describe, expect, it } from 'vitest';

import type { RecentFrame } from '@canvas/engine';

import { FRAME_BUDGET_MS, stageSegments } from './frame-bars.js';

const FRAME: RecentFrame = {
  frameIndex: 4,
  cpuMs: 20,
  stageMs: { collect: 0, draw: 10, present: 20 },
  drawCalls: 2,
  segments: 3,
  visibleRecords: 4,
  renderPasses: 5,
  pipelineSwitches: 6,
  pastBudgetMs: 20 - 1000 / 60,
};

describe('stageSegments', () => {
  it('keeps measured positive stages in order and divides by the supplied budget', () => {
    const before = structuredClone(FRAME);
    expect(stageSegments(FRAME, 10)).toEqual([
      { stage: 'draw', ms: 10, fraction: 1 },
      { stage: 'present', ms: 20, fraction: 2 },
    ]);
    expect(FRAME).toEqual(before);
  });

  it('drops zero, missing and unmeasured stages', () => {
    expect(stageSegments({ ...FRAME, stageMs: { collect: 0, draw: Number.NaN } }, 10)).toEqual([]);
  });

  it('uses a 60 Hz frame budget without clamping over-budget fractions', () => {
    expect(FRAME_BUDGET_MS).toBe(1000 / 60);
    expect(stageSegments(FRAME, FRAME_BUDGET_MS)[1]?.fraction).toBeGreaterThan(1);
  });
});
