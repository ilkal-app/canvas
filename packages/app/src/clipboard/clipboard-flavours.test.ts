import { describe, expect, it } from 'vitest';

import { copySelection } from '@canvas/document';
import {
  DEFAULT_PAGE,
  exportBoard,
  type ObjectId,
  type TokenEntry,
  type TokenTable,
} from '@canvas/schema';

import { BODY, BOLD, clipboardBoard } from './__fixtures__/clipboard-board.js';
import { decodeObjectsFlavour, encodeClipboardFlavours } from './clipboard-flavours.js';
import {
  CANVAS_OBJECTS_MIME_TYPE,
  EMBEDDED_OBJECTS_ATTRIBUTE,
  HTML_MIME_TYPE,
  PLAIN_TEXT_MIME_TYPE,
} from './clipboard-formats.js';
import { MAX_PASTE_MARKUP_LENGTH, MAX_PASTE_OBJECTS } from './clipboard-notice.js';

/**
 * A copy of the fixture's title and photo.
 *
 * @returns The copy.
 * @throws {Error} When nothing was copied.
 */
function copiedTitleAndPhoto() {
  const copied = copySelection(clipboardBoard(), ['title', 'photo'] as ObjectId[]);
  if (copied === undefined) throw new Error('nothing was copied');
  return copied;
}

/**
 * The portable document of the copy with one change to its title.
 *
 * @param change - Fields to set on the title.
 * @returns The document's JSON.
 */
function withTitle(change: Record<string, unknown>): string {
  const document = exportBoard(copiedTitleAndPhoto());
  const objects = document.objects.map((object) =>
    object.id === 'title' ? { ...object, ...change } : object,
  );
  return JSON.stringify({ ...document, objects });
}

describe('decodeObjectsFlavour and the board bound', () => {
  it('refuses, with the paste notice, a document that places an object past the bound', () => {
    for (const change of [{ x: 1e308 }, { width: 2 ** 31 }]) {
      expect(decodeObjectsFlavour(withTitle(change))).toMatchObject({
        kind: 'refused',
        notice: { code: 'paste-refused' },
      });
    }
  });

  it('still takes a malformed document for invalid, so the next flavour follows', () => {
    expect(decodeObjectsFlavour(withTitle({ width: -1 }))).toEqual({ kind: 'invalid' });
  });
});

describe('encodeClipboardFlavours', () => {
  it('writes the objects, their texts one per line, and styled HTML, in that order', () => {
    const copied = copySelection(clipboardBoard(), ['title', 'outside', 'group'] as ObjectId[]);
    const flavours = encodeClipboardFlavours(copied ?? clipboardBoard());
    expect([...flavours.keys()]).toEqual([
      CANVAS_OBJECTS_MIME_TYPE,
      PLAIN_TEXT_MIME_TYPE,
      HTML_MIME_TYPE,
    ]);
    expect(flavours.get(PLAIN_TEXT_MIME_TYPE)).toBe('Bold 👋 plain');
    const html = flavours.get(HTML_MIME_TYPE) ?? '';
    expect(html).toContain(`<div ${EMBEDDED_OBJECTS_ATTRIBUTE}="{&quot;format&quot;`);
    expect(html).toContain('font-weight: 700; font-style: normal">Bold </span>');
    expect(html).toContain('font-weight: 400; font-style: normal">👋 plain</span>');
  });

  it('writes each text on its own line and line breaks as <br>', () => {
    const board = clipboardBoard();
    const title = board.objects.get('title' as ObjectId);
    if (title?.type !== 'text') throw new Error('the title is a text');
    const twoLines = {
      ...title,
      id: 'note' as ObjectId,
      z: 'a9',
      text: 'one\ntwo',
      runs: [{ length: 7, style: BODY }],
    };
    const copied = copySelection(
      { objects: new Map([...board.objects, [twoLines.id, twoLines]]) },
      ['title', 'note'] as ObjectId[],
    );
    const flavours = encodeClipboardFlavours(copied ?? board);
    expect(flavours.get(PLAIN_TEXT_MIME_TYPE)).toBe('Bold 👋 plain\none\ntwo');
    expect(flavours.get(HTML_MIME_TYPE)).toContain('>one<br>two</span>');
  });
});

describe('encodeClipboardFlavours with colour tokens', () => {
  /**
   * The fixture's title, coloured with the given colour, copied alone.
   *
   * @param color - The title's run colour.
   * @returns The copy.
   * @throws {Error} When the fixture has no text title, or nothing was copied.
   */
  function titleIn(color: unknown) {
    const board = clipboardBoard();
    const title = board.objects.get('title' as ObjectId);
    if (title?.type !== 'text') throw new Error('the title is a text');
    const coloured = {
      ...title,
      runs: title.runs.map((run) => ({ ...run, style: { ...run.style, color } })),
    };
    const copied = copySelection(
      { objects: new Map([...board.objects, [coloured.id, coloured as typeof title]]) },
      ['title'] as ObjectId[],
    );
    if (copied === undefined) throw new Error('nothing was copied');
    return copied;
  }

  const brand: TokenEntry = {
    id: 'brand',
    name: 'Brand',
    light: [1, 0, 0, 1],
    dark: [0, 0, 1, 1],
    builtin: false,
    createdBy: null,
    createdAt: 0,
  };

  it("writes a token in the text's mode from the board's table", () => {
    const tokens: TokenTable = new Map([[brand.id, brand]]);
    const copied = titleIn({ token: 'brand' });
    const dark = encodeClipboardFlavours(copied, undefined, { tokens, modeOf: () => 'dark' });
    expect(dark.get(HTML_MIME_TYPE)).toContain('color: rgba(0, 0, 255, 1)');
    const light = encodeClipboardFlavours(copied, undefined, { tokens });
    expect(light.get(HTML_MIME_TYPE)).toContain('color: rgba(255, 0, 0, 1)');
  });

  it('writes a built-in token at its light default without a table, as ink always was', () => {
    const html = encodeClipboardFlavours(titleIn({ token: 'accent' })).get(HTML_MIME_TYPE);
    // accent's light default, #b7801c.
    expect(html).toContain('color: rgba(183, 128, 28, 1)');
  });
});

describe('decodeObjectsFlavour', () => {
  it('reads back the copied board', () => {
    const copied = copiedTitleAndPhoto();
    const json = encodeClipboardFlavours(copied).get(CANVAS_OBJECTS_MIME_TYPE) ?? '';
    // The copy carries the board's pages: the default page here.
    expect(decodeObjectsFlavour(json)).toEqual({
      kind: 'board',
      board: { ...copied, pages: new Map([[DEFAULT_PAGE.id, DEFAULT_PAGE]]) },
    });
  });

  it('refuses text that is not a valid portable board', () => {
    const valid = exportBoard(copiedTitleAndPhoto());
    const refused = [
      'not json',
      '{}',
      '[]',
      JSON.stringify({ ...valid, format: 'other' }),
      withTitle({ width: -1 }),
      withTitle({ parentId: 'nowhere' }),
      withTitle({ id: 'photo' }),
      withTitle({ unknown: true }),
    ];
    for (const json of refused) expect(decodeObjectsFlavour(json)).toEqual({ kind: 'invalid' });
    // A version this build does not know is newer, told apart so the person can reload.
    const newer = JSON.stringify({ ...valid, schemaVersion: 999 });
    expect(decodeObjectsFlavour(newer)).toEqual({ kind: 'newer' });
  });

  it('refuses a document over the paste limits without importing it', () => {
    // Over 2 MiB is still parsed (the 5,000-object cap is the real limit); over 4 MiB is not.
    expect(decodeObjectsFlavour(' '.repeat(MAX_PASTE_MARKUP_LENGTH))).toEqual({ kind: 'invalid' });
    const tooLong = ' '.repeat(MAX_PASTE_MARKUP_LENGTH + 1);
    expect(decodeObjectsFlavour(tooLong)).toEqual({ kind: 'over-limit' });
    const document = exportBoard(copiedTitleAndPhoto());
    const many = { ...document, objects: Array.from({ length: MAX_PASTE_OBJECTS + 1 }, () => 0) };
    expect(decodeObjectsFlavour(JSON.stringify(many))).toMatchObject({
      kind: 'too-many',
      notice: { code: 'paste-too-large' },
    });
  });

  it('refuses runs that split a character, as importBoard does', () => {
    const splitsEmoji = withTitle({
      runs: [
        { length: 6, style: BOLD },
        { length: 7, style: BODY },
      ],
    });
    expect(decodeObjectsFlavour(splitsEmoji)).toEqual({ kind: 'invalid' });
  });
});
