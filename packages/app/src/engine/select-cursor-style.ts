import {
  ROTATE_CURSOR_STEPS,
  rotateCursorStepOf,
  type RotateCursor,
  type ToolCursor,
} from '@canvas/tools';

/**
 * The rotate cursor's drawing: a quarter arc with an arrowhead at each end, black over a white
 * halo so it reads on any board, in a 24 CSS px square. Untouched, the arc wraps the top-left
 * corner of a box below and to its right (a `RotateCursor` angle of 0). Everything lies within 12 px of the centre (12, 12), halo
 * included, so the drawing turns about it without clipping.
 */
const ROTATE_CURSOR_DRAWING = [
  "<g fill='none' stroke-linecap='round' stroke-linejoin='round'>",
  "<path d='M6 17A11 11 0 0 1 17 6' stroke='white' stroke-width='5'/>",
  "<path d='M3 14L6 19L9 14M14 3L19 6L14 9' stroke='white' stroke-width='5'/>",
  "<path d='M6 17A11 11 0 0 1 17 6' stroke='black' stroke-width='2'/>",
  "<path d='M3 14L6 19L9 14M14 3L19 6L14 9' stroke='black' stroke-width='2'/>",
  '</g>',
].join('');

/** One orientation step, degrees. */
const STEP_DEGREES = 360 / ROTATE_CURSOR_STEPS;

/**
 * The CSS cursor for the drawing turned about the hotspot: an inline SVG image with its hotspot
 * at the centre, falling back to `crosshair` where images are not allowed as cursors.
 *
 * @param turn - The turn, whole degrees clockwise in [0, 360); 0 leaves the drawing untouched.
 * @returns The CSS value.
 */
function rotateCursorCss(turn: number): string {
  const drawing =
    turn === 0
      ? ROTATE_CURSOR_DRAWING
      : `<g transform='rotate(${String(turn)} 12 12)'>${ROTATE_CURSOR_DRAWING}</g>`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'>${drawing}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, crosshair`;
}

/**
 * The CSS cursor over the band outside the top-left corner of an unturned selection: the
 * drawing untouched. CSS has no rotate cursor, hence an image.
 */
export const ROTATE_CURSOR_CSS = rotateCursorCss(0);

/**
 * How far to turn the drawing for a rotate cursor's angle (the corner's quarter turn plus the
 * selection's rotation), to the nearest 15°.
 *
 * @param angle - The rotate cursor's angle, radians.
 * @returns The turn, whole degrees clockwise, a multiple of 15 in [0, 360).
 */
export function rotateCursorTurnOf(angle: number): number {
  return rotateCursorStepOf(angle) * STEP_DEGREES;
}

/** The rotate cursor's CSS values, one per orientation step, each built on first use. */
export interface RotateCursorImages {
  /**
   * The CSS value for a rotate cursor: the same string for every angle in one step.
   *
   * @param cursor - The rotate cursor.
   * @returns The CSS value.
   */
  cssOf(cursor: RotateCursor): string;
  /** How many steps have been built, at most `ROTATE_CURSOR_STEPS`. */
  readonly size: number;
}

/**
 * An empty cache of the rotate cursor's CSS values, so however the cursor turns, the page builds
 * at most {@link ROTATE_CURSOR_STEPS} data URIs over the page's life. Main thread.
 *
 * @returns The cache.
 */
export function createRotateCursorImages(): RotateCursorImages {
  const byStep = new Map<number, string>();
  return {
    cssOf(cursor) {
      const step = rotateCursorStepOf(cursor.angle);
      let css = byStep.get(step);
      if (css === undefined) {
        css = rotateCursorCss(rotateCursorTurnOf(cursor.angle));
        byStep.set(step, css);
      }
      return css;
    },
    get size() {
      return byStep.size;
    },
  };
}

/** The page's rotate cursor values. */
const ROTATE_CURSOR_IMAGES = createRotateCursorImages();

/**
 * The CSS `cursor` value for the cursor the active tool asks for: the rotate cursor turned to
 * its angle in 15° steps (cached per step), or the CSS keyword of the same name (`default`, the
 * I-beam `text` over text, `crosshair` for a creation tool). Constant time.
 *
 * @param cursor - The active tool's cursor.
 * @returns The CSS value to set on the canvas.
 */
export function cssCursorOf(cursor: ToolCursor): string {
  return typeof cursor === 'string' ? cursor : ROTATE_CURSOR_IMAGES.cssOf(cursor);
}
