import { isSameTextStyle, type StyleRun, type TextStyle } from '@canvas/schema';

/**
 * Brings runs to the schema's run invariant (`findRunIssues`; the prototype's `normalize`,
 * webgl-whiteboard `src/text/runs.ts`): merges neighbours of equal style and drops zero-length
 * runs; when nothing is left, keeps one zero-length run in `fallback`, so empty text still has
 * the style typing will use. Run boundaries are not moved, so they stay between characters if
 * they were. Pure; returns new runs.
 *
 * @param runs - The runs, lengths in UTF-16 code units.
 * @param fallback - The style of empty text; default the first run's.
 * @returns The normalised runs.
 * @throws {RangeError} When there are no runs and no fallback.
 */
export function normalizeRuns(runs: readonly StyleRun[], fallback?: TextStyle): StyleRun[] {
  const merged: StyleRun[] = [];
  for (const run of runs) {
    if (run.length <= 0) continue;
    const last = merged.at(-1);
    if (last !== undefined && isSameTextStyle(last.style, run.style)) {
      merged[merged.length - 1] = { length: last.length + run.length, style: last.style };
    } else {
      merged.push({ length: run.length, style: run.style });
    }
  }
  if (merged.length > 0) return merged;
  const style = fallback ?? runs[0]?.style;
  if (style === undefined) throw new RangeError('Empty runs need a fallback style.');
  return [{ length: 0, style }];
}
