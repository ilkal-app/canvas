import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import type { TextContent, TextStyle } from '@canvas/schema';

import {
  EMPTY_TEXT_STYLE_KEY,
  readRichText,
  runsFromDelta,
  TEXT_KEY,
  writeRichText,
} from './rich-text-codec.js';

const BODY: TextStyle = {
  fontFamily: 'Inter',
  fontSize: 24,
  color: [0.1, 0.1, 0.1, 1],
  weight: 400,
  italic: false,
};
const BOLD: TextStyle = { ...BODY, weight: 700 };
const RED: TextStyle = { ...BODY, color: [0.8, 0.1, 0.1, 1] };

/**
 * Creates a host map integrated in a fresh document, as an object's map would be.
 *
 * @returns The host map.
 */
function createHost(): Y.Map<unknown> {
  const host = new Y.Map<unknown>();
  new Y.Doc().getMap('objects').set('host', host);
  return host;
}

describe('runsFromDelta', () => {
  it('merges neighbouring ops with equal styles, which Yjs may emit after concurrent formats', () => {
    const attributes = { ...BOLD };
    expect(
      runsFromDelta(
        [
          { insert: 'ab', attributes },
          { insert: 'c', attributes: { ...BOLD } },
          { insert: 'de', attributes: { ...BODY } },
        ],
        BODY,
      ),
    ).toEqual({
      text: 'abcde',
      runs: [
        { length: 3, style: BOLD },
        { length: 2, style: BODY },
      ],
    });
  });

  it('gives empty text its single zero-length run in the style of empty text', () => {
    expect(runsFromDelta([], RED)).toEqual({ text: '', runs: [{ length: 0, style: RED }] });
  });

  it('refuses embeds, which this package never writes', () => {
    expect(runsFromDelta([{ insert: { image: 'x' } }], BODY)).toBeNull();
    expect(runsFromDelta(['text'], BODY)).toBeNull();
  });
});

describe('writeRichText and readRichText', () => {
  const content: TextContent = {
    text: 'Launch plan v2',
    runs: [
      { length: 12, style: BOLD },
      { length: 2, style: RED },
    ],
  };

  it('stores the characters as a Y.Text whose attributes carry the runs', () => {
    const host = createHost();
    writeRichText(host, content);
    const text = host.get(TEXT_KEY);
    expect(text).toBeInstanceOf(Y.Text);
    // Only the fields that differ from the base style (Inter, 16, black, 400, upright).
    expect((text as Y.Text).toDelta()).toEqual([
      { insert: 'Launch plan ', attributes: { fontSize: 24, color: BODY.color, weight: 700 } },
      { insert: 'v2', attributes: { fontSize: 24, color: RED.color } },
    ]);
    expect(readRichText(host)).toEqual(content);
  });

  it('reads characters carrying redundant attributes, base values included, and edits them', () => {
    const host = createHost();
    const text = new Y.Text();
    host.set(TEXT_KEY, text);
    host.set(EMPTY_TEXT_STYLE_KEY, BOLD);
    text.insert(0, 'Launch plan ', { ...BOLD });
    text.insert(12, 'v2', { ...RED });
    expect(readRichText(host)).toEqual(content);
    writeRichText(host, { text: 'Launch plan v2', runs: [{ length: 14, style: RED }] });
    expect(readRichText(host)).toEqual({
      text: 'Launch plan v2',
      runs: [{ length: 14, style: RED }],
    });
  });

  it('round-trips text outside the basic plane, counted in UTF-16 code units', () => {
    const host = createHost();
    const emoji: TextContent = { text: 'Ship 😀!', runs: [{ length: 8, style: BODY }] };
    writeRichText(host, emoji);
    expect(readRichText(host)).toEqual(emoji);
  });

  it('keeps the style of empty text beside the Y.Text', () => {
    const host = createHost();
    const empty: TextContent = { text: '', runs: [{ length: 0, style: RED }] };
    writeRichText(host, empty);
    expect(host.get(EMPTY_TEXT_STYLE_KEY)).toEqual(RED);
    expect(readRichText(host)).toEqual(empty);
  });

  it('updates the same Y.Text in place, touching only what changed', () => {
    const host = createHost();
    writeRichText(host, content);
    const text = host.get(TEXT_KEY) as Y.Text;
    const edits: unknown[] = [];
    text.observe((event) => edits.push(...event.delta));
    const next: TextContent = {
      text: 'Launch plan v3',
      runs: [
        { length: 12, style: BOLD },
        { length: 2, style: RED },
      ],
    };
    host.doc?.transact(() => {
      writeRichText(host, next);
    });
    expect(host.get(TEXT_KEY)).toBe(text);
    expect(readRichText(host)).toEqual(next);
    expect(edits).toEqual([
      { retain: 13 },
      { delete: 1 },
      { insert: '3', attributes: { fontSize: 24, color: RED.color } },
    ]);
  });

  it('restyles in place when only the runs change', () => {
    const host = createHost();
    writeRichText(host, content);
    const restyled: TextContent = {
      text: 'Launch plan v2',
      runs: [
        { length: 7, style: BODY },
        { length: 7, style: BOLD },
      ],
    };
    writeRichText(host, restyled);
    expect(readRichText(host)).toEqual(restyled);
  });

  it('never splits a surrogate pair when diffing, so no character is replaced', () => {
    const host = createHost();
    writeRichText(host, { text: 'a😀b', runs: [{ length: 4, style: BODY }] });
    const next: TextContent = { text: 'a😁b', runs: [{ length: 4, style: BODY }] };
    writeRichText(host, next);
    expect(readRichText(host)).toEqual(next);
  });

  it('reports a text field that is not a Y.Text', () => {
    const host = createHost();
    host.set(TEXT_KEY, 'plain');
    expect(readRichText(host)).toBe('the text is not a Y.Text');
    host.set(TEXT_KEY, new Y.Text());
    expect(readRichText(host)).toBe('the style of empty text is missing');
  });
});
