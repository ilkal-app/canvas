/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { isEmojiPresentation as publicIsEmojiPresentation } from '../index.js';

import { isEmojiPresentation } from './emoji-presentation.js';

const UCD = new URL('../unicode/__fixtures__/ucd-17.0.0/', import.meta.url);

/**
 * Reads data rows from a checked-in Unicode 17 emoji file.
 *
 * @param name - UCD basename without `.txt.gz`.
 * @returns The codepoint field and property or sequence type of each row.
 */
function rowsOf(name: string): (readonly [string, string])[] {
  return gunzipSync(readFileSync(new URL(`${name}.txt.gz`, UCD)))
    .toString('utf8')
    .split(/\r?\n/u)
    .flatMap((line) => {
      const [data = ''] = line.split('#', 1);
      const [codepoints = '', type = ''] = data.split(';').map((field) => field.trim());
      return codepoints.length > 0 && type.length > 0 ? [[codepoints, type] as const] : [];
    });
}

/**
 * Expands a UCD codepoint or inclusive codepoint range.
 *
 * @param field - One hex codepoint or `first..last`.
 * @returns The codepoints named by the field.
 */
function codepointsOf(field: string): number[] {
  const [first = '', last = first] = field.split('..');
  const codepoints: number[] = [];
  for (let point = Number.parseInt(first, 16); point <= Number.parseInt(last, 16); point += 1) {
    codepoints.push(point);
  }
  return codepoints;
}

describe('Unicode 17 emoji presentation', () => {
  it('exports the classifier from the package root', () => {
    expect(publicIsEmojiPresentation).toBe(isEmojiPresentation);
  });

  it('recognizes every RGI emoji sequence in both Unicode 17 sequence files', () => {
    for (const name of ['emoji-sequences', 'emoji-zwj-sequences']) {
      for (const [field, type] of rowsOf(name)) {
        if (field.includes('..')) {
          expect(type).toBe('Basic_Emoji');
          for (const point of codepointsOf(field)) {
            expect(isEmojiPresentation(String.fromCodePoint(point)), `${name}: ${field}`).toBe(
              true,
            );
          }
        } else {
          const text = field
            .split(/\s+/u)
            .map((point) => String.fromCodePoint(Number.parseInt(point, 16)))
            .join('');
          expect(isEmojiPresentation(text), `${name}: ${field}`).toBe(true);
        }
      }
    }
  });

  it('keeps every text-default Emoji character as text unless VS16 requests emoji', () => {
    const presentation = new Set<number>();
    for (const [field, property] of rowsOf('emoji-data')) {
      if (property === 'Emoji_Presentation') {
        for (const point of codepointsOf(field)) presentation.add(point);
      }
    }
    for (const [field, property] of rowsOf('emoji-data')) {
      if (property !== 'Emoji') continue;
      for (const point of codepointsOf(field)) {
        if (presentation.has(point)) continue;
        const character = String.fromCodePoint(point);
        expect(isEmojiPresentation(character), `U+${point.toString(16)}`).toBe(false);
        expect(isEmojiPresentation(`${character}\ufe0f`), `U+${point.toString(16)} VS16`).toBe(
          true,
        );
      }
    }
  });

  it('honors VS15 on every emoji-default character', () => {
    for (const [field, property] of rowsOf('emoji-data')) {
      if (property !== 'Emoji_Presentation') continue;
      for (const point of codepointsOf(field)) {
        expect(
          isEmojiPresentation(`${String.fromCodePoint(point)}\ufe0e`),
          `U+${point.toString(16)} VS15`,
        ).toBe(false);
      }
    }
  });

  it('does not promote ordinary text or a lone regional indicator', () => {
    // UTS #51 makes a flag from a pair of regional indicators; one indicator is neither a flag
    // sequence nor Emoji_Presentation=Yes in emoji-data.txt.
    for (const text of ['A', '中', '\u{1f1fa}']) {
      expect(isEmojiPresentation(text), text).toBe(false);
    }
  });
});
