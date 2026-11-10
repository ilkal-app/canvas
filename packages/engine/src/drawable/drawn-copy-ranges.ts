import {
  MAX_DRAWABLE_SIZE,
  MIN_FONT_SIZE,
  type BoardObject,
  type StyleRun,
  type UndrawableReason,
} from '@canvas/schema';

// A scaled instance draws its content's copies up to 20 times larger or smaller than
// its main stores them, nested instances compounding: a 24 px font at 20× is 480 px, a 1 px
// stroke at 0.05× is 0.05 px. The stored ranges (a font from 4 to 400, a stroke at most 64 wide,
// a letter-spacing or line-height in px within its limit) bound what may be written; what the
// engine needs of a drawn copy is finite numbers within the drawable size, which these judge.

/**
 * Tells whether an object is an instance's virtual copy, judged by drawn ranges: its id is a
 * virtual address (`instanceId/path`, never a stored id), as `isVirtualObjectId` says.
 *
 * @param object - An object of a change set.
 * @returns Whether it is a virtual copy.
 */
export function isDrawnCopy(object: BoardObject): boolean {
  return object.id.includes('/');
}

/**
 * Judges a drawn length: finite and within `MAX_DRAWABLE_SIZE`; above 0 unless it is signed.
 *
 * @param value - The length.
 * @param isSigned - Whether it may be 0 or negative (a letter-spacing).
 * @returns The reason, or undefined.
 */
function drawnLengthReason(value: number, isSigned: boolean): UndrawableReason | undefined {
  if (!Number.isFinite(value)) return 'not-finite';
  if (Math.abs(value) > MAX_DRAWABLE_SIZE) return 'past-extent';
  return isSigned || value > 0 ? undefined : 'out-of-range';
}

/**
 * Judges a virtual copy's own content scale: a nested instance's copy composes its
 * scale with its enclosing instances', which may leave the stored 0.05 to 20; finite and above 0
 * is what drawing it needs.
 *
 * @param scale - The copy's scale.
 * @returns The reason, or undefined.
 */
export function drawnCopyScaleReason(scale: number): UndrawableReason | undefined {
  return drawnLengthReason(scale, false);
}

/**
 * Judges a virtual copy's runs by drawn ranges: each font size, and each letter-spacing or
 * line-height in px, a drawn length. The runs it returns carry in-range stand-ins for those, so
 * the stored-range check (`textRunsReason`) judges the rest: lengths, weights, colours, percents.
 *
 * @param runs - The copy's runs.
 * @returns The first reason, or the runs to judge the rest of.
 */
export function drawnCopyRuns(
  runs: readonly StyleRun[],
): { readonly reason: UndrawableReason } | { readonly runs: readonly StyleRun[] } {
  const judged: StyleRun[] = [];
  for (const run of runs) {
    const { fontSize, letterSpacing, lineHeight, ...style } = run.style;
    const spacingPx = letterSpacing?.unit === 'px' ? letterSpacing.value : undefined;
    const linePx =
      typeof lineHeight === 'object' && lineHeight.unit === 'px' ? lineHeight.value : undefined;
    const reason =
      drawnLengthReason(fontSize, false) ??
      (spacingPx === undefined ? undefined : drawnLengthReason(spacingPx, true)) ??
      (linePx === undefined ? undefined : drawnLengthReason(linePx, false));
    if (reason !== undefined) return { reason };
    judged.push({
      ...run,
      style: {
        ...style,
        fontSize: MIN_FONT_SIZE,
        ...(letterSpacing === undefined || spacingPx !== undefined ? {} : { letterSpacing }),
        ...(lineHeight === undefined || linePx !== undefined ? {} : { lineHeight }),
      },
    });
  }
  return { runs: judged };
}
