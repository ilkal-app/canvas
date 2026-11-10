/// <reference types="node" />
// A combining mark can make a face split the base it sits on
// (Merriweather's "i" with a macron below shapes to a dotless i, a dot and the mark), and a mark
// can decompose (U+0344), so a mark gets three records. This shapes every soft-dotted base with every Combining Diacritical Mark in
// every bundled library face and holds the glyphs to the records the text pass gives them.
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { loadShaper, shapeText } from '@canvas/text';

import { textObject } from './__fixtures__/text-objects.js';
import { textRecordCount } from './text-record-count.js';

const LIBRARY = new URL('../../../../app/assets/fonts/library/', import.meta.url);
const BASES = ['i', 'j', 'į', 'ı', 'I', 'a'];

interface Catalogue {
  readonly entries: readonly {
    readonly family: string;
    readonly faces: readonly { url: string }[];
  }[];
}

describe('text records for combining marks', () => {
  it('fit every glyph a library face shapes a base and a mark to', async () => {
    const shaper = await loadShaper();
    const catalogue = JSON.parse(
      readFileSync(new URL('catalogue.json', LIBRARY), 'utf8'),
    ) as Catalogue;
    const overflows: string[] = [];
    for (const { family, faces } of catalogue.entries) {
      for (const { url } of faces) {
        const bytes = readFileSync(new URL(url, LIBRARY));
        const face = shaper.face(`marks:${url}`, bytes);
        for (const base of BASES) {
          for (let mark = 0x0300; mark <= 0x036f; mark += 1) {
            const text = `${base}${String.fromCodePoint(mark)}`;
            const glyphs = shapeText(shaper, face, text, 0, text.length).glyphs.length;
            const records = textRecordCount(textObject('t', text));
            if (glyphs > records) overflows.push(`${family} ${url} ${text}: ${String(glyphs)}`);
          }
        }
      }
    }
    expect(overflows).toEqual([]);
  });
});
