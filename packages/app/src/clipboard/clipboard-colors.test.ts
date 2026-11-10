import { describe, expect, it } from 'vitest';

import { copySelection } from '@canvas/document';
import {
  createBoard,
  INK_COLORS,
  type Board,
  type BoardObject,
  type ObjectId,
  type Rgba,
  type TextStyle,
} from '@canvas/schema';

import { BODY, clipboardBoard, objectOf } from './__fixtures__/clipboard-board.js';
import { clipboardColorsOf } from './clipboard-colors.js';
import { encodeClipboardFlavours } from './clipboard-flavours.js';
import { HTML_MIME_TYPE } from './clipboard-formats.js';

const PASTEL: Rgba = [1, 0.93, 0.6, 1];
const NAVY: Rgba = [0.05, 0.08, 0.2, 1];

/**
 * The fixture board with its frame changed and an ink note of a colour in it.
 *
 * @param frame - Fields the frame takes.
 * @param color - The note's colour.
 * @param textColor - Its text's colour.
 * @returns The board.
 */
function boardWithNote(
  frame: Record<string, unknown>,
  color: Rgba,
  textColor: TextStyle['color'] = 'ink',
): Board {
  const fixture = clipboardBoard();
  const objects = [...fixture.objects.values()].map((object) =>
    object.id === 'frame' ? { ...object, ...frame } : object,
  );
  const shared = objectOf(fixture, 'title');
  const note = {
    ...shared,
    id: 'note' as ObjectId,
    parentId: 'frame' as ObjectId,
    type: 'sticky',
    width: 120,
    height: 120,
    text: 'Hi',
    runs: [{ length: 2, style: { ...BODY, color: textColor } }],
    align: 'center',
    autoWidth: false,
    verticalAlign: 'middle',
    color,
  } as BoardObject;
  return createBoard([...objects, note]);
}

/**
 * A colour as the HTML flavour writes it.
 *
 * @param color - The colour.
 * @returns Its CSS `rgba(…)`.
 */
function css(color: Rgba): string {
  const [red, green, blue] = color.slice(0, 3).map((channel) => Math.round(channel * 255));
  return `rgba(${String(red)}, ${String(green)}, ${String(blue)}, ${String(color[3])})`;
}

/**
 * The HTML flavour of a copy of the note.
 *
 * @param board - The board.
 * @returns The HTML.
 * @throws {Error} When the note cannot be copied.
 */
function noteHtml(board: Board): string {
  const copied = copySelection(board, ['note'] as ObjectId[]);
  if (copied === undefined) throw new Error('the note is copyable');
  const colors = clipboardColorsOf(new Map());
  return encodeClipboardFlavours(copied, undefined, colors).get(HTML_MIME_TYPE) ?? '';
}

describe('clipboardColorsOf', () => {
  // Another app's document is usually white and the note's fill does not travel: dark ink.
  const darkInk = `color: ${css(INK_COLORS.light)}`;

  it("writes a pastel note's ink dark inside a dark-mode frame", () => {
    expect(noteHtml(boardWithNote({ colorMode: 'dark' }, PASTEL))).toContain(darkInk);
  });

  it("writes a navy note's ink dark on a light frame, though the board draws it light", () => {
    expect(noteHtml(boardWithNote({ background: [1, 1, 1, 1] }, NAVY))).toContain(darkInk);
  });

  it('writes an explicit text colour as set, in a dark-mode frame', () => {
    const set: Rgba = [0.9, 0.1, 0.1, 1];
    expect(noteHtml(boardWithNote({ colorMode: 'dark' }, NAVY, set))).toContain(
      `color: ${css(set)}`,
    );
  });

  it("gives every object the light mode, and the board's tokens", () => {
    const tokens = new Map();
    const colors = clipboardColorsOf(tokens);
    expect(colors.tokens).toBe(tokens);
    expect(colors.modeOf?.('note' as ObjectId)).toBe('light');
  });
});
