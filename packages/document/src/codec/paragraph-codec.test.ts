import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  LAST_PARAGRAPH_KEY,
  PARAGRAPH_ATTRIBUTE,
  readParagraphs,
  writeParagraphs,
} from './paragraph-codec.js';

const BULLET = { list: 'bullet' } as const;
const NUMBERED = { list: 'numbered' } as const;
const RUN = { fontFamily: 'Inter', fontSize: 16, color: [0, 0, 0, 1], weight: 400, italic: false };

/**
 * Builds a document-integrated map holding a `Y.Text`, for reading paragraphs as a peer left them.
 *
 * @param characters - The text.
 * @param doc - The document; a new one by default.
 * @returns The map and its text.
 */
function hostOf(characters: string, doc = new Y.Doc()): { host: Y.Map<unknown>; text: Y.Text } {
  const host = doc.getMap<unknown>('host');
  const text = new Y.Text();
  host.set('text', text);
  text.insert(0, characters);
  return { host, text };
}

/**
 * Brings a text to new characters and paragraph styles the way the codec does: a minimal
 * character edit, then the paragraphs.
 *
 * @param host - The map.
 * @param text - Its text.
 * @param characters - The new characters; the current ones plus an appended suffix.
 * @param paragraphs - The wanted styles.
 */
function write(
  host: Y.Map<unknown>,
  text: Y.Text,
  characters: string,
  paragraphs: readonly object[],
): void {
  const current = text.toJSON();
  if (characters.length > current.length)
    text.insert(current.length, characters.slice(current.length));
  writeParagraphs(
    host,
    text,
    {
      text: characters,
      runs: [{ length: characters.length, style: RUN }],
      paragraphs,
    } as never,
    false,
  );
}

/**
 * Exchanges every update between two documents.
 *
 * @param first - One document.
 * @param second - The other.
 */
function sync(first: Y.Doc, second: Y.Doc): void {
  Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
  Y.applyUpdate(first, Y.encodeStateAsUpdate(second));
}

describe('readParagraphs', () => {
  it('reads nothing while every paragraph is plain', () => {
    const { host, text } = hostOf('one\ntwo');
    expect(readParagraphs(host, text)).toBeUndefined();
  });

  it('reads a malformed stored style or anchor as plain or the last paragraph', () => {
    const { host, text } = hostOf('one\ntwo\nthree');
    text.format(3, 1, { [PARAGRAPH_ATTRIBUTE]: { list: 'checklist' } });
    text.format(7, 1, { [PARAGRAPH_ATTRIBUTE]: { list: 'bullet', level: 1 } });
    host.set(LAST_PARAGRAPH_KEY, 'not a style');
    expect(readParagraphs(host, text)).toEqual([{}, { list: 'bullet', level: 1 }, {}]);
    host.set(LAST_PARAGRAPH_KEY, { style: NUMBERED, after: { malformed: true } });
    expect(readParagraphs(host, text)).toEqual([{}, { list: 'bullet', level: 1 }, NUMBERED]);
  });

  it('reads an unanchored last style, written before the text had a document, as the last', () => {
    const { host, text } = hostOf('one\ntwo');
    host.set(LAST_PARAGRAPH_KEY, { style: BULLET });
    expect(readParagraphs(host, text)).toEqual([{}, BULLET]);
  });
});

describe('the last paragraph under concurrent edits', () => {
  it('keeps a restyle on its paragraph when a peer appends a newline after it', () => {
    for (const [adaId, bobId] of [
      [1, 2],
      [2, 1],
    ] as const) {
      const ada = new Y.Doc();
      ada.clientID = adaId;
      const { host: adaHost, text: adaText } = hostOf('last', ada);
      write(adaHost, adaText, 'last', [BULLET]);
      const bob = new Y.Doc();
      bob.clientID = bobId;
      sync(ada, bob);
      const bobHost = bob.getMap<unknown>('host');
      const bobText = bobHost.get('text') as Y.Text;

      write(adaHost, adaText, 'last\n', [BULLET, {}]);
      write(bobHost, bobText, 'last', [NUMBERED]);
      sync(ada, bob);

      expect(readParagraphs(adaHost, adaText)).toEqual([NUMBERED, {}]);
      expect(readParagraphs(bobHost, bobText)).toEqual([NUMBERED, {}]);
    }
  });

  it('writes nothing when the last style and its anchor are unchanged', () => {
    const doc = new Y.Doc();
    const { host, text } = hostOf('one\ntwo', doc);
    write(host, text, 'one\ntwo', [{}, BULLET]);
    const before = Y.encodeStateVector(doc);
    write(host, text, 'one\ntwo', [{}, BULLET]);
    expect(Y.encodeStateVector(doc)).toEqual(before);
  });
});
