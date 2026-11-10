import type { StickyAspect, StyleRun } from '@canvas/schema';

import type { TextLayout } from '../layout/text-layout.js';

import { noteHeightFor, noteMinHeight } from './text-boxes.js';

/**
 * The smallest a sticky note's text shrinks to, CSS px of its largest run: below it the
 * note grows instead, as it did before auto-fit, so no text is ever hidden.
 */
export const NOTE_FIT_FLOOR_PX = 8;

/** A sticky note's text and the box it must fit. */
export interface NoteFitInput {
  /** The note's text. */
  readonly text: string;
  /** Its stored runs: each run's `fontSize` is the largest it is drawn at. */
  readonly runs: readonly StyleRun[];
  /** The height of the note's text box (`noteTextPlacement`), world units. */
  readonly boxHeight: number;
}

/** What a fit needs of a layout: its height. */
export interface NoteFitLayout {
  /** The laid-out text's height, world units. */
  readonly height: number;
}

/**
 * A sticky note's text at the size it is drawn at.
 *
 * @template L - The layout the caller's `layoutAt` returns: a full `TextLayout`, or a
 *   measurement.
 */
export interface NoteFit<L extends NoteFitLayout = TextLayout> {
  /**
   * The drawn size of the note's largest run, px: the stored maximum when the text fits at it (or
   * when the maximum is already below the floor), else the largest whole size between the floor
   * and the maximum at which it fits, else the floor.
   */
  readonly fittedFontSize: number;
  /** `fittedFontSize` over the largest stored run size: 1 when nothing shrinks. */
  readonly scale: number;
  /** The stored runs with every `fontSize` times `scale`: the stored array itself at 1. */
  readonly runs: readonly StyleRun[];
  /** The text laid out at {@link NoteFit.runs}. */
  readonly layout: L;
  /** Whether the text is taller than the box even at the floor, so the note must grow. */
  readonly isOverflowing: boolean;
}

/**
 * Fits a sticky note's text to its box (, "the font-size
 * dropdown sets a maximum and auto-fit stays on"): the largest whole px size of its largest run,
 * from the stored maximum down to {@link NOTE_FIT_FLOOR_PX}, at which the laid-out text is no
 * taller than the box, every run scaled by the same factor so a mix of sizes keeps its
 * proportions. Found by bisection over the whole sizes, so a note takes at most about
 * log2(maximum) + 2 layouts, and only when its text, style or box changes. The fit is never
 * stored: the page, the engine's layout jobs and headless each compute it with their own
 * `layoutAt`, which is why the result depends only on the input and the layouts. Pure.
 *
 * @param input - The note's text, stored runs and text box height.
 * @param layoutAt - Lays the note's text out with some runs: the caller's measurer, wrapping at
 *   the note's width with its alignment.
 * @returns The fitted runs, their layout and whether they still overflow.
 */
export function fitNoteText<L extends NoteFitLayout = TextLayout>(
  input: NoteFitInput,
  layoutAt: (runs: readonly StyleRun[]) => L,
): NoteFit<L> {
  const { runs, boxHeight } = input;
  const maximum = largestFontSize(runs);
  const stored = layoutAt(runs);
  if (input.text === '' || maximum <= NOTE_FIT_FLOOR_PX || fits(stored, boxHeight)) {
    return {
      fittedFontSize: maximum,
      scale: 1,
      runs,
      layout: stored,
      isOverflowing: !fits(stored, boxHeight),
    };
  }
  const floorRuns = scaleRuns(runs, NOTE_FIT_FLOOR_PX / maximum);
  const floorLayout = layoutAt(floorRuns);
  if (!fits(floorLayout, boxHeight)) {
    return {
      fittedFontSize: NOTE_FIT_FLOOR_PX,
      scale: NOTE_FIT_FLOOR_PX / maximum,
      runs: floorRuns,
      layout: floorLayout,
      isOverflowing: true,
    };
  }
  // The floor fits and the maximum does not: the largest whole size in between that fits.
  let best = { size: NOTE_FIT_FLOOR_PX, runs: floorRuns, layout: floorLayout };
  let low = NOTE_FIT_FLOOR_PX + 1;
  let high = Math.ceil(maximum) - 1;
  while (low <= high) {
    const size = Math.floor((low + high) / 2);
    const scaled = scaleRuns(runs, size / maximum);
    const layout = layoutAt(scaled);
    if (fits(layout, boxHeight)) {
      best = { size, runs: scaled, layout };
      low = size + 1;
    } else {
      high = size - 1;
    }
  }
  return {
    fittedFontSize: best.size,
    scale: best.size / maximum,
    runs: best.runs,
    layout: best.layout,
    isOverflowing: false,
  };
}

/**
 * The height a note is measured to once its text is fitted: it keeps its height (at
 * least its aspect's least, `noteMinHeight`) while the fitted text fits, and grows as before
 * auto-fit (`noteHeightFor`) only when the text overflows even at the floor. It never shrinks:
 * a note made or grown taller keeps that height. Pure.
 *
 * @param note - The note's width, stored height and aspect.
 * @param note.width - Its width, world units.
 * @param note.height - Its stored height, world units.
 * @param note.aspect - Its aspect; square when absent.
 * @param fit - Its text's fit ({@link fitNoteText}).
 * @returns The height, world units.
 */
export function fittedNoteHeight(
  note: {
    readonly width: number;
    readonly height: number;
    readonly aspect?: StickyAspect | undefined;
  },
  fit: NoteFit<NoteFitLayout>,
): number {
  const needed = fit.isOverflowing
    ? noteHeightFor(note.width, fit.layout.height, note.aspect)
    : noteMinHeight(note.width, note.aspect);
  return Math.max(note.height, needed);
}

/**
 * Whether a layout fits a box's height. A hair's tolerance absorbs the float sums of line heights.
 *
 * @param layout - The layout.
 * @param boxHeight - The box's height.
 * @returns Whether it fits.
 */
function fits(layout: NoteFitLayout, boxHeight: number): boolean {
  return layout.height <= boxHeight + 1e-6;
}

/**
 * The largest run size, px; 0 for no runs.
 *
 * @param runs - The runs.
 * @returns The size.
 */
function largestFontSize(runs: readonly StyleRun[]): number {
  let largest = 0;
  for (const run of runs) largest = Math.max(largest, run.style.fontSize);
  return largest;
}

/**
 * The runs with every size times a factor. Pure: new runs, the input untouched.
 *
 * @param runs - The stored runs.
 * @param factor - The scale.
 * @returns The scaled runs.
 */
function scaleRuns(runs: readonly StyleRun[], factor: number): readonly StyleRun[] {
  return runs.map((run) => ({
    ...run,
    style: { ...run.style, fontSize: run.style.fontSize * factor },
  }));
}
