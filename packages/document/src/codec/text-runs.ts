import { isSameTextStyle, type StyleRun, type TextStyle } from '@canvas/schema';

/**
 * Cuts the part `[start, end)` out of a run list, in UTF-16 code units (the prototype's
 * `sliceRuns`, `src/text/runs.ts`).
 *
 * @param runs - The runs, covering a text in order.
 * @param start - The first code unit of the part.
 * @param end - The code unit after the part.
 * @returns The runs of the part, without zero-length runs; empty when `start >= end`.
 */
export function sliceRuns(runs: readonly StyleRun[], start: number, end: number): StyleRun[] {
  const part: StyleRun[] = [];
  let position = 0;
  for (const run of runs) {
    const from = Math.max(position, start);
    const to = Math.min(position + run.length, end);
    if (to > from) part.push({ length: to - from, style: run.style });
    position += run.length;
  }
  return part;
}

/**
 * Appends a run to a list, merging it into the last run when the styles are equal, so the list
 * keeps the schema's rule that neighbouring runs differ.
 *
 * @param runs - The list to append to; modified in place (it is the caller's own new list).
 * @param length - The run length in UTF-16 code units; nothing is appended when 0.
 * @param style - The run's style.
 */
export function appendRun(runs: StyleRun[], length: number, style: TextStyle): void {
  if (length === 0) return;
  const last = runs.at(-1);
  if (last !== undefined && isSameTextStyle(last.style, style)) {
    runs[runs.length - 1] = { length: last.length + length, style: last.style };
  } else {
    runs.push({ length, style });
  }
}

/** A stretch of text over which neither of two run lists changes style. */
export interface RunOverlap {
  /** The first code unit of the stretch. */
  readonly start: number;
  /** The stretch length in UTF-16 code units, at least 1. */
  readonly length: number;
  /** The style in the first run list. */
  readonly before: TextStyle;
  /** The style in the second run list. */
  readonly after: TextStyle;
}

/**
 * Walks two run lists over the same text together and lists the stretches where both keep one
 * style, so a restyle can format only where the style changes.
 *
 * @param before - The runs as they are.
 * @param after - The runs as they should be; covering the same length as `before`.
 * @returns The stretches in order, covering the shorter of the two lists.
 */
export function overlapRuns(before: readonly StyleRun[], after: readonly StyleRun[]): RunOverlap[] {
  const overlaps: RunOverlap[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  let beforeLeft = before[0]?.length ?? 0;
  let afterLeft = after[0]?.length ?? 0;
  let position = 0;
  while (beforeIndex < before.length && afterIndex < after.length) {
    const beforeRun = before[beforeIndex];
    const afterRun = after[afterIndex];
    if (beforeRun === undefined || afterRun === undefined) break;
    const length = Math.min(beforeLeft, afterLeft);
    if (length > 0) {
      overlaps.push({ start: position, length, before: beforeRun.style, after: afterRun.style });
    }
    position += length;
    beforeLeft -= length;
    afterLeft -= length;
    if (beforeLeft === 0) beforeLeft = before[(beforeIndex += 1)]?.length ?? 0;
    if (afterLeft === 0) afterLeft = after[(afterIndex += 1)]?.length ?? 0;
  }
  return overlaps;
}
