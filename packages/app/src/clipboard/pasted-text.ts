import type { NewObject } from '@canvas/document';
import {
  isSameTextStyle,
  type Point,
  type StyleRun,
  type TextContent,
  type TextStyle,
} from '@canvas/schema';

/**
 * The style of text pasted from outside the canvas, where the source gives none: the document's
 * base style (Inter, 16 world px, opaque black, regular, upright).
 */
export const PASTED_TEXT_STYLE: TextStyle = Object.freeze<TextStyle>({
  fontFamily: 'Inter',
  fontSize: 16,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
});

/** The line height of the estimated text box, in multiples of the font size. */
const LINE_HEIGHT = 1.25;

/** The estimated advance of one character, in multiples of the font size. */
const CHARACTER_WIDTH = 0.6;

/**
 * Builds text and runs from styled pieces, merging neighbours of equal style so the schema's run
 * invariant holds (adjacent runs differ). Each piece is whole characters, so every run boundary
 * falls between characters.
 *
 * @param pieces - The text in order, each piece with its style; empty pieces are skipped.
 * @returns The text and runs, or `undefined` when there is no text.
 */
export function textContentOf(
  pieces: readonly { readonly text: string; readonly style: TextStyle }[],
): TextContent | undefined {
  const runs: StyleRun[] = [];
  let text = '';
  for (const piece of pieces) {
    if (piece.text.length === 0) continue;
    text += piece.text;
    const last = runs.at(-1);
    if (last !== undefined && isSameTextStyle(last.style, piece.style)) {
      runs[runs.length - 1] = { length: last.length + piece.text.length, style: last.style };
    } else {
      runs.push({ length: piece.text.length, style: piece.style });
    }
  }
  return text.length === 0 ? undefined : { text, runs };
}

/**
 * The text object a paste of text from outside creates: auto-width,
 * left-aligned, centred on the point. Its box is estimated from the character count and the
 * largest font size, since the page does not lay out text; the text editor re-measures
 * it on the first edit.
 *
 * @param content - The text and runs.
 * @param at - Where to centre it, board coordinates.
 * @returns The object, as `createObjects` lists it.
 */
export function newTextObject(content: TextContent, at: Point): NewObject {
  const fontSize = content.runs.reduce(
    (largest, { style }) => Math.max(largest, style.fontSize),
    0,
  );
  const lines = content.text.split('\n');
  const longest = lines.reduce((most, line) => Math.max(most, line.length), 0);
  const width = Math.max(1, longest * fontSize * CHARACTER_WIDTH);
  const height = lines.length * fontSize * LINE_HEIGHT;
  return {
    type: 'text',
    parentId: null,
    x: at.x - width / 2,
    y: at.y - height / 2,
    rotation: 0,
    locked: false,
    width,
    height,
    text: content.text,
    runs: content.runs.map((run) => ({ length: run.length, style: run.style })),
    // Pasted lists keep their paragraph styles.
    ...(content.paragraphs?.some((style) => style.list !== undefined) === true
      ? { paragraphs: [...content.paragraphs] }
      : {}),
    align: 'left',
    autoWidth: true,
    verticalAlign: 'top',
  };
}
