// Written before the code. CONTRACT: linked glyphs produce bidi-aware flat underline quads at the line baseline. Deliberately not asserted: URL navigation or vector export.
import { describe, expect, it } from 'vitest';

import type { TextStyle } from '@canvas/schema';
import { layoutText, type TextLayout } from '@canvas/text';

import { FakeGlyphMeasurer } from '../layout/__fixtures__/fake-glyph-measurer.js';
import type { GlyphQuad } from '../renderer/glyph-instance.js';

import { linkUnderlineQuads } from './link-underline.js';

const BASE: TextStyle = {
  fontFamily: 'Fake',
  fontSize: 10,
  color: [0.2, 0.4, 0.6, 1],
  weight: 400,
  italic: false,
};
const LINK = 'https://example.com/a';
const measurer = new FakeGlyphMeasurer();

function quads(layout: TextLayout, zoom = 1) {
  const underlines = linkUnderlineQuads as (
    layout: TextLayout,
    origin: { x: number; y: number },
    zoom: number,
  ) => { quads: readonly { quad: GlyphQuad }[] };
  return underlines(layout, { x: 0, y: 0 }, zoom).quads.map(({ quad }) => quad);
}

describe('linkUnderlineQuads', () => {
  it('spans exactly one linked word and places its top below the baseline', () => {
    const layout = layoutText(
      'a bc d',
      [
        { length: 2, style: BASE },
        { length: 2, style: { ...BASE, link: LINK } },
        { length: 2, style: BASE },
      ],
      null,
      measurer,
    );
    expect(quads(layout)).toEqual([
      expect.objectContaining({
        x: 12,
        y: 10.25,
        width: 12,
        height: 1,
        color: BASE.color,
        u0: -1,
        v0: -1,
        u1: -1,
        v1: -1,
      }),
    ]);
    expect(quads(layout, 4)[0]?.height).toBeCloseTo(0.6, 9);
  });

  it('makes one quad on each line of a wrapped link and excludes trailing line spaces', () => {
    const layout = layoutText(
      'ab cd',
      [{ length: 5, style: { ...BASE, link: LINK } }],
      20,
      measurer,
    );
    expect(quads(layout).map(({ x, width, y }) => ({ x, width, y }))).toEqual([
      { x: 0, width: 12, y: 10.25 },
      { x: 0, width: 12, y: 22.75 },
    ]);
  });

  it('covers adjacent links with different URLs once, without a gap or overlap', () => {
    const layout = layoutText(
      'abcd',
      [
        { length: 2, style: { ...BASE, link: LINK } },
        { length: 2, style: { ...BASE, link: 'https://example.com/b' } },
      ],
      null,
      measurer,
    );
    const spans = quads(layout).map(({ x, width }) => [x, x + width]);
    expect(spans[0]?.[0]).toBe(0);
    expect(spans.at(-1)?.[1]).toBe(24);
    for (let index = 1; index < spans.length; index += 1) {
      expect(spans[index]?.[0]).toBe(spans[index - 1]?.[1]);
    }
  });

  it('uses visual extents of an RTL link within a mixed-direction line', () => {
    const source = layoutText(
      'aאבb',
      [
        { length: 1, style: BASE },
        { length: 2, style: { ...BASE, link: LINK } },
        { length: 1, style: BASE },
      ],
      null,
      measurer,
    );
    const layout: TextLayout = {
      ...source,
      glyphs: source.glyphs.map((glyph) =>
        glyph.index === 1
          ? { ...glyph, x: 12, level: 1 }
          : glyph.index === 2
            ? { ...glyph, x: 6, level: 1 }
            : glyph,
      ),
    };
    expect(quads(layout).map(({ x, width }) => [x, width])).toEqual([[6, 12]]);
  });

  it('makes no underline for a link containing only spaces or for unlinked text', () => {
    const spaces = layoutText(
      '   ',
      [{ length: 3, style: { ...BASE, link: LINK } }],
      null,
      measurer,
    );
    const plain = layoutText('abc', [{ length: 3, style: BASE }], null, measurer);
    expect(quads(spaces)).toEqual([]);
    expect(quads(plain)).toEqual([]);
  });
});
