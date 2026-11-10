import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { StyleRun } from '@canvas/schema';

import { coverageRuns } from './coverage-runs.js';
import { FontLibrary } from './font-library.js';

/**
 * Reads a font fixture into a transferable buffer.
 *
 * @param url - File URL relative to this test.
 * @returns The file bytes.
 */
function bytesOf(url: string): ArrayBuffer {
  const bytes = readFileSync(new URL(url, import.meta.url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

describe('coverage runs with named faces', () => {
  it('keeps the chosen coverage face name in the layout-only run', () => {
    const library = new FontLibrary();
    const plain = library.addFace(
      { family: 'Private Sans', weight: 400, isItalic: false },
      bytesOf('../../../assets/fonts/LiberationSans-Regular.ttf'),
    );
    const namedFace = {
      family: 'Noto Sans Symbols 2',
      weight: 400,
      isItalic: false,
      postScriptName: 'PrivateSymbols',
    } as const;
    const named = library.addFace(
      namedFace,
      bytesOf('../../../../app/assets/fonts/script-coverage/notosanssymbols2/400.ttf'),
    );
    const codepoint = named.font
      .characterMap()
      .find(([point]) => point >= 0x2000 && plain.font.glyphIdOf(point) === 0)?.[0];
    if (codepoint === undefined) throw new Error('The fixture has no distinct symbol glyph.');
    const text = String.fromCodePoint(codepoint);
    const runs: StyleRun[] = [
      {
        length: text.length,
        style: {
          fontFamily: 'Private Sans',
          fontSize: 24,
          weight: 400,
          italic: false,
          color: 'ink',
        },
      },
    ];
    expect(coverageRuns(text, runs, library)).toEqual([
      {
        length: text.length,
        style: {
          ...runs[0]?.style,
          fontFamily: 'Noto Sans Symbols 2',
          postScriptName: 'PrivateSymbols',
        },
      },
    ]);
  });
});
