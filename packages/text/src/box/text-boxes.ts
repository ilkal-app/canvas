// The sizing rules of the text boxes the app lays out: a sticky note's
// padding and growth, a connector label's wrapping width. The engine places text with them and
// agents measure with them, so both agree.
import type { StickyAspect } from '@canvas/schema';

/**
 * A sticky note's padding round its text on every side, world units (the prototype's
 * `NOTE_PADDING`, webgl-whiteboard `src/board/note.ts`).
 */
export const NOTE_PADDING = 16;

/**
 * The width a note's text wraps at: the note's width less its padding on both sides, never
 * below one world unit (a note resized narrower than its padding still lays out). Pure.
 *
 * @param width - The note's width, world units.
 * @returns The wrapping width, world units.
 */
export function noteWrapWidth(width: number): number {
  return Math.max(1, width - 2 * NOTE_PADDING);
}

/**
 * The height of a note's text box: the note's height less its padding above and below, never
 * below zero (`noteTextPlacement`; the box its text is fitted to). Pure.
 *
 * @param height - The note's height, world units.
 * @returns The text box's height, world units.
 */
export function noteBoxHeight(height: number): number {
  return Math.max(0, height - 2 * NOTE_PADDING);
}

/**
 * The least height a note has whatever its text: its width for a square note, half its
 * width for a wide one. Pure.
 *
 * @param width - The note's width, world units.
 * @param aspect - The note's aspect; square when absent.
 * @returns The height, world units.
 */
export function noteMinHeight(width: number, aspect?: StickyAspect): number {
  return aspect === 'wide' ? width / 2 : width;
}

/**
 * The height a note needs for some laid-out text: at least square (at
 * least half its width for a wide note), and taller once the text and its padding need
 * more room. Since auto-fit a note grows only by text that overflows at the fit's floor
 * (`fittedNoteHeight`). Pure.
 *
 * @param width - The note's width, world units.
 * @param textHeight - Its laid-out text's height, world units.
 * @param aspect - The note's aspect; square when absent.
 * @returns The note's height, world units.
 */
export function noteHeightFor(width: number, textHeight: number, aspect?: StickyAspect): number {
  return Math.max(noteMinHeight(width, aspect), textHeight + 2 * NOTE_PADDING);
}

/**
 * The width a connector's label wraps at, world units: a label is a short caption on
 * the line, so longer text wraps onto lines centred on the route rather than running along it.
 */
export const CONNECTOR_LABEL_WRAP_WIDTH = 200;
