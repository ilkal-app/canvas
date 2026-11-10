import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import { appendRun, overlapRuns, sliceRuns } from './text-runs.js';

const BODY: TextStyle = {
  fontFamily: 'Inter',
  fontSize: 24,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
};
const BOLD: TextStyle = { ...BODY, weight: 700 };
const RUNS: StyleRun[] = [
  { length: 3, style: BODY },
  { length: 4, style: BOLD },
];

describe('text run helpers', () => {
  it('slice a part of the runs', () => {
    expect(sliceRuns(RUNS, 2, 5)).toEqual([
      { length: 1, style: BODY },
      { length: 2, style: BOLD },
    ]);
    expect(sliceRuns(RUNS, 4, 4)).toEqual([]);
  });

  it('append a run, merging an equal neighbour and skipping empty runs', () => {
    const runs: StyleRun[] = [];
    appendRun(runs, 2, BODY);
    appendRun(runs, 0, BOLD);
    appendRun(runs, 3, { ...BODY });
    appendRun(runs, 1, BOLD);
    expect(runs).toEqual([
      { length: 5, style: BODY },
      { length: 1, style: BOLD },
    ]);
  });

  it('walk two run lists together into stretches of one style each', () => {
    expect(
      overlapRuns(RUNS, [
        { length: 5, style: BOLD },
        { length: 2, style: BODY },
      ]),
    ).toEqual([
      { start: 0, length: 3, before: BODY, after: BOLD },
      { start: 3, length: 2, before: BOLD, after: BOLD },
      { start: 5, length: 2, before: BOLD, after: BODY },
    ]);
    expect(overlapRuns([{ length: 0, style: BODY }], [{ length: 0, style: BOLD }])).toEqual([]);
  });
});
