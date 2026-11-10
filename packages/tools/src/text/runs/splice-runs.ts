import type { StyleRun, TextStyle } from '@canvas/schema';

import { normalizeRuns } from './normalize-runs.js';

/**
 * Splits runs at a position: the runs before it and the runs from it on (a run across it is cut
 * in two).
 *
 * @param runs - The runs.
 * @param at - The position, UTF-16 code units.
 * @returns The two halves.
 */
export function splitRunsAt(
  runs: readonly StyleRun[],
  at: number,
): [before: StyleRun[], after: StyleRun[]] {
  const before: StyleRun[] = [];
  const after: StyleRun[] = [];
  let start = 0;
  for (const run of runs) {
    const end = start + run.length;
    if (end <= at) before.push(run);
    else if (start >= at) after.push(run);
    else {
      before.push({ length: at - start, style: run.style });
      after.push({ length: end - at, style: run.style });
    }
    start = end;
  }
  return [before, after];
}

/**
 * Replaces a range of the text's runs with `insertLength` code units in one style: the runs'
 * half of an edit that deletes `[start, end)` and inserts characters there (the prototype's
 * `spliceRuns`). Emptying the text keeps the style of the first deleted character for the empty
 * text. The positions must lie between characters (not inside a surrogate pair), as must the
 * inserted text's ends, so the result's boundaries do too. Pure; returns new, normalised runs.
 *
 * @param runs - The runs.
 * @param start - Where the range starts, UTF-16 code units.
 * @param end - Where it ends (exclusive).
 * @param insertLength - How many code units are inserted there.
 * @param style - Their style.
 * @returns The runs after the edit.
 */
export function spliceRuns(
  runs: readonly StyleRun[],
  start: number,
  end: number,
  insertLength: number,
  style: TextStyle,
): StyleRun[] {
  const [before, rest] = splitRunsAt(runs, start);
  const [removed, after] = splitRunsAt(rest, end - start);
  const emptied = removed.find((run) => run.length > 0)?.style ?? style;
  return normalizeRuns([...before, { length: insertLength, style }, ...after], emptied);
}

/**
 * The runs covering a range, for copying it (the prototype's `sliceRuns`). Pure.
 *
 * @param runs - The runs.
 * @param start - Where the range starts, UTF-16 code units.
 * @param end - Where it ends (exclusive).
 * @returns The range's runs, normalised; empty for an empty range.
 */
export function sliceRuns(runs: readonly StyleRun[], start: number, end: number): StyleRun[] {
  if (start >= end) return [];
  const [, rest] = splitRunsAt(runs, start);
  const [middle] = splitRunsAt(rest, end - start);
  return middle.filter((run) => run.length > 0);
}

/**
 * Splices a run list in at a position, for a styled paste (the prototype's `insertRuns`). Pure.
 *
 * @param runs - The runs.
 * @param at - Where, UTF-16 code units, between characters.
 * @param inserted - The pasted text's runs.
 * @returns The runs after the paste, normalised.
 */
export function insertRuns(
  runs: readonly StyleRun[],
  at: number,
  inserted: readonly StyleRun[],
): StyleRun[] {
  const [before, after] = splitRunsAt(runs, at);
  return normalizeRuns([...before, ...inserted, ...after], runs[0]?.style ?? inserted[0]?.style);
}
