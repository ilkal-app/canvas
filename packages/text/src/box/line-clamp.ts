import type { StyleRun } from '@canvas/schema';

// Clamping a text's paragraphs to a number of lines each (a link card's title and
// description, two lines each): a paragraph laid out on more lines is cut where its last allowed
// line can still hold an ellipsis. Found by bisection over the cut, so a clamped paragraph takes
// about log2(its last line's length) + 1 layouts, and only when its text or box changes. Pure.

/** The ellipsis a clamped paragraph ends with. */
export const LINE_CLAMP_ELLIPSIS = '…';

/** What a clamp needs of a layout: its lines, where each starts and ends, and which end hard. */
export interface LineClampLayout {
  /** The lines, top to bottom. */
  readonly lines: readonly {
    /** Index of its first character, in UTF-16 code units. */
    readonly start: number;
    /** Exclusive end. */
    readonly end: number;
    /** Whether a newline or the end of the text ends it. */
    readonly isHard: boolean;
  }[];
}

/** A text clamped, and its layout. */
export interface LineClamp<L extends LineClampLayout> {
  /** The text, each clamped paragraph cut and ended with {@link LINE_CLAMP_ELLIPSIS}. */
  readonly text: string;
  /** Its runs: a cut paragraph's last kept run takes the ellipsis. */
  readonly runs: readonly StyleRun[];
  /** The text laid out. */
  readonly layout: L;
}

/**
 * The lines of each paragraph: the first line's index in the layout and how many there are.
 *
 * @param layout - The layout.
 * @returns One entry per paragraph, in order.
 */
function paragraphLinesOf(layout: LineClampLayout): { first: number; count: number }[] {
  const paragraphs: { first: number; count: number }[] = [];
  let current: { first: number; count: number } | undefined;
  layout.lines.forEach((line, index) => {
    current ??= { first: index, count: 0 };
    current.count += 1;
    if (line.isHard) {
      paragraphs.push(current);
      current = undefined;
    }
  });
  if (current !== undefined) paragraphs.push(current);
  return paragraphs;
}

/**
 * Runs with the characters from `from` to `to` replaced by `inserted` characters in the style of
 * the character before `from` (or after it at the start). Pure.
 *
 * @param runs - The runs.
 * @param from - The first removed index.
 * @param to - One past the last removed index.
 * @param inserted - How many characters are inserted.
 * @returns The runs; empty runs are dropped.
 */
function replaceInRuns(
  runs: readonly StyleRun[],
  from: number,
  to: number,
  inserted: number,
): StyleRun[] {
  const result: StyleRun[] = [];
  let start = 0;
  let isInserted = false;
  for (const run of runs) {
    const end = start + run.length;
    const kept = Math.max(0, Math.min(end, from) - start) + Math.max(0, end - Math.max(start, to));
    // The insertion joins the run holding the character before the cut, or at a cut at the
    // start, the first character's.
    const at = from > 0 ? from - 1 : 0;
    const isHolder = !isInserted && start <= at && at < end;
    const length = kept + (isHolder ? inserted : 0);
    if (isHolder) isInserted = true;
    if (length > 0) result.push({ ...run, length });
    start = end;
  }
  return result;
}

/**
 * Where a paragraph may be cut at most: before `index`, stepping back over a split surrogate pair
 * and trailing white space.
 *
 * @param text - The text.
 * @param start - The paragraph's last allowed line's start: the cut never goes before it.
 * @param index - The cut.
 * @returns The cut, adjusted.
 */
function cutAt(text: string, start: number, index: number): number {
  let cut = index;
  const code = text.charCodeAt(cut - 1);
  if (cut > start && code >= 0xd800 && code <= 0xdbff) cut -= 1;
  while (cut > start && /\s/u.test(text.charAt(cut - 1))) cut -= 1;
  return cut;
}

/**
 * Clamps each paragraph of a text to its line cap: a paragraph laid out on more lines
 * than its cap keeps its first lines and ends its last allowed one with an ellipsis, cut as late
 * as the ellipsis still fits on that line. A paragraph with no cap (past the end of `caps`) is
 * left whole. The newlines stay, so paragraph styles keep their paragraphs. Pure.
 *
 * @param input - The text, its runs, and each paragraph's most lines.
 * @param input.text - The text.
 * @param input.runs - Its runs.
 * @param input.caps - The most lines of each paragraph, in order; at least 1 each.
 * @param layoutOf - Lays a text out with its runs: the caller's measurer, width and alignment.
 * @returns The clamped text, its runs and its layout.
 */
export function clampLines<L extends LineClampLayout>(
  input: {
    readonly text: string;
    readonly runs: readonly StyleRun[];
    readonly caps: readonly number[];
  },
  layoutOf: (text: string, runs: readonly StyleRun[]) => L,
): LineClamp<L> {
  let { text, runs } = input;
  let layout = layoutOf(text, runs);
  const original = paragraphLinesOf(layout);
  // From the last paragraph back, so an earlier paragraph's offsets stay those of `original`.
  for (let paragraph = original.length - 1; paragraph >= 0; paragraph -= 1) {
    const cap = Math.max(1, Math.floor(input.caps[paragraph] ?? Number.POSITIVE_INFINITY));
    const lines = original[paragraph];
    if (lines === undefined || lines.count <= cap) continue;
    const last = layout.lines[lines.first + cap - 1];
    const ending = layout.lines[lines.first + lines.count - 1];
    if (last === undefined || ending === undefined) continue;
    const paragraphEnd = ending.end;
    const fitsWith = (cut: number): { text: string; runs: StyleRun[]; layout: L } | undefined => {
      const next = `${text.slice(0, cut)}${LINE_CLAMP_ELLIPSIS}${text.slice(paragraphEnd)}`;
      const nextRuns = replaceInRuns(runs, cut, paragraphEnd, LINE_CLAMP_ELLIPSIS.length);
      const nextLayout = layoutOf(next, nextRuns);
      const count = paragraphLinesOf(nextLayout)[paragraph]?.count ?? 0;
      return count <= cap ? { text: next, runs: nextRuns, layout: nextLayout } : undefined;
    };
    // The latest cut on the last allowed line at which the ellipsis still fits on it.
    let best = fitsWith(cutAt(text, last.start, last.start));
    let low = last.start + 1;
    let high = last.end;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const found = fitsWith(cutAt(text, last.start, middle));
      if (found === undefined) {
        high = middle - 1;
      } else {
        best = found;
        low = middle + 1;
      }
    }
    if (best === undefined) continue;
    ({ text, runs, layout } = best);
  }
  return { text, runs, layout };
}
