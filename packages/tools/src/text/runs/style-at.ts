import type { StyleRun, TextStyle } from '@canvas/schema';

/**
 * The last run, which every run list has.
 *
 * @param runs - The runs.
 * @returns The last run's style.
 * @throws {RangeError} When there are no runs.
 */
function lastStyle(runs: readonly StyleRun[]): TextStyle {
  const last = runs.at(-1);
  if (last === undefined) throw new RangeError('Text has at least one style run.');
  return last.style;
}

/**
 * The style of the character before a caret position, which typing there continues (the
 * prototype's `styleAt`, webgl-whiteboard `src/text/runs.ts`); at 0, the first run's. Pure.
 *
 * @param runs - The runs.
 * @param index - The caret position, UTF-16 code units.
 * @returns The style.
 * @throws {RangeError} When there are no runs.
 */
export function styleAt(runs: readonly StyleRun[], index: number): TextStyle {
  let end = 0;
  for (const run of runs) {
    end += run.length;
    if (run.length > 0 && index <= end) return run.style;
  }
  return lastStyle(runs);
}

/**
 * The style of the character at an index, clamped to the last run (the prototype's
 * `styleOfChar`). Pure.
 *
 * @param runs - The runs.
 * @param index - The character's index, UTF-16 code units.
 * @returns The style.
 * @throws {RangeError} When there are no runs.
 */
export function styleOfCharacter(runs: readonly StyleRun[], index: number): TextStyle {
  let start = 0;
  for (const run of runs) {
    if (index < start + run.length) return run.style;
    start += run.length;
  }
  return lastStyle(runs);
}

/**
 * The largest font size among the runs, world px: the minimum sensible box width follows it.
 * Pure.
 *
 * @param runs - The runs.
 * @returns The size; 0 for no runs.
 */
export function maxFontSize(runs: readonly StyleRun[]): number {
  return runs.reduce((largest, run) => Math.max(largest, run.style.fontSize), 0);
}
