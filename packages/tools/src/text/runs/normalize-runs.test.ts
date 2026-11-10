import { describe, expect, it } from 'vitest';

import { BASE, BOLD, runsOf } from './__fixtures__/text-styles.js';
import { normalizeRuns } from './normalize-runs.js';

describe('normalizeRuns', () => {
  it('merges neighbours of equal style and drops zero-length runs', () => {
    expect(normalizeRuns(runsOf([2, BASE], [0, BOLD], [3, { ...BASE }], [1, BOLD]))).toEqual(
      runsOf([5, BASE], [1, BOLD]),
    );
  });

  it('keeps one zero-length run for empty text, in the fallback or the first style', () => {
    expect(normalizeRuns(runsOf([0, BOLD]))).toEqual(runsOf([0, BOLD]));
    expect(normalizeRuns(runsOf([0, BOLD]), BASE)).toEqual(runsOf([0, BASE]));
    expect(() => normalizeRuns([])).toThrow(RangeError);
  });
});
