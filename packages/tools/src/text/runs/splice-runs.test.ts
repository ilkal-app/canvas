import { describe, expect, it } from 'vitest';

import { findRunIssues, type StyleRun } from '@canvas/schema';

import { BASE, BOLD, LARGE, RED, runsOf } from './__fixtures__/text-styles.js';
import { insertRuns, sliceRuns, spliceRuns } from './splice-runs.js';

describe('spliceRuns', () => {
  it('inserts in a style mid-run, splitting it', () => {
    expect(spliceRuns(runsOf([4, BASE]), 2, 2, 3, BOLD)).toEqual(
      runsOf([2, BASE], [3, BOLD], [2, BASE]),
    );
  });

  it('deletes across run boundaries and merges what meets', () => {
    const runs = runsOf([2, BASE], [3, BOLD], [2, BASE]);
    expect(spliceRuns(runs, 1, 6, 0, BOLD)).toEqual(runsOf([2, BASE]));
  });

  it('keeps the first deleted style for text it empties', () => {
    expect(spliceRuns(runsOf([2, BOLD], [2, RED]), 0, 4, 0, BASE)).toEqual(runsOf([0, BOLD]));
    expect(spliceRuns(runsOf([0, RED]), 0, 0, 2, LARGE)).toEqual(runsOf([2, LARGE]));
  });

  it('keeps every result under the run invariant through a random edit sequence', () => {
    const styles = [BASE, BOLD, RED, LARGE];
    let seed = 7;
    const next = (below: number): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % below;
    };
    let text = '';
    let runs: StyleRun[] = runsOf([0, BASE]);
    for (let step = 0; step < 500; step += 1) {
      const start = next(text.length + 1);
      const end = start + next(text.length - start + 1);
      const inserted = 'ab😀c'.slice(0, next(3) === 0 ? 0 : 1 + next(4));
      const safe = inserted.endsWith('\ud83d') ? inserted.slice(0, -1) : inserted;
      const style = styles[next(styles.length)] ?? BASE;
      // Edits land between code points, as the editor's do.
      const from = isInsidePair(text, start) ? start - 1 : start;
      const to = isInsidePair(text, end) ? end + 1 : end;
      runs = spliceRuns(runs, from, to, safe.length, style);
      text = text.slice(0, from) + safe + text.slice(to);
      expect(findRunIssues(text, runs), `step ${String(step)}`).toEqual([]);
    }
  });
});

/**
 * Whether a position falls between the two halves of a surrogate pair.
 *
 * @param text - The text.
 * @param index - The position.
 * @returns Whether it splits a pair.
 */
function isInsidePair(text: string, index: number): boolean {
  const code = text.charCodeAt(index);
  return index > 0 && code >= 0xdc00 && code <= 0xdfff;
}

describe('sliceRuns and insertRuns', () => {
  it('slices the runs of a range across boundaries, none for an empty one', () => {
    const runs = runsOf([2, BASE], [3, BOLD], [2, RED]);
    expect(sliceRuns(runs, 1, 6)).toEqual(runsOf([1, BASE], [3, BOLD], [1, RED]));
    expect(sliceRuns(runs, 3, 3)).toEqual([]);
  });

  it('splices pasted runs in, merging equal neighbours', () => {
    const runs = runsOf([2, BASE], [2, BOLD]);
    expect(insertRuns(runs, 2, runsOf([1, BASE], [1, RED]))).toEqual(
      runsOf([3, BASE], [1, RED], [2, BOLD]),
    );
    expect(insertRuns(runsOf([0, BASE]), 0, runsOf([2, RED]))).toEqual(runsOf([2, RED]));
    expect(insertRuns([], 0, runsOf([2, RED]))).toEqual(runsOf([2, RED]));
  });
});
