import { describe, expect, it } from 'vitest';

import type { TextStyle } from '@canvas/schema';
import { layoutText } from '@canvas/text';

import { FakeGlyphMeasurer } from '../layout/__fixtures__/fake-glyph-measurer.js';

import { GREEK_ALPHA, GREEK_PAGE_RECT, greekQuads, isGreekQuad } from './greek-quads.js';

const STYLE: TextStyle = {
  fontFamily: 'Fake',
  fontSize: 10,
  color: [0.2, 0.4, 0.6, 1],
  weight: 400,
  italic: false,
};

describe('greekQuads', () => {
  // With font size 10 the fake measurer advances 6 a character and a line is 12.5 tall.
  const layout = layoutText(
    'ab cd\nef',
    [{ length: 8, style: STYLE }],
    null,
    new FakeGlyphMeasurer(),
  );

  it('gives every glyph that is not a space a bar over its advance, in record order', () => {
    const { quads, isComplete } = greekQuads(layout, { x: 5, y: 7 });
    expect(isComplete).toBe(true);
    // a, b, c, d, e, f: the space draws nothing and has no record, like the glyphs.
    expect(quads).toHaveLength(6);
    const xs = quads.map((entry) => entry?.quad.x);
    expect(xs).toEqual([5, 11, 23, 29, 5, 11]);
    for (const entry of quads) expect(entry?.quad.width).toBe(6);
  });

  it('draws each bar across the middle of its line, 40% of the line tall', () => {
    const { quads } = greekQuads(layout, { x: 0, y: 0 });
    const first = quads[0]?.quad;
    const secondLine = quads[4]?.quad;
    expect(first?.height).toBeCloseTo(5, 9);
    expect(first?.y).toBeCloseTo(3.75, 9);
    expect(secondLine?.y).toBeCloseTo(12.5 + 3.75, 9);
  });

  it('greys each bar to 30% of its run colour, flat (no atlas page)', () => {
    const { quads } = greekQuads(layout, { x: 0, y: 0 });
    const entry = quads[0];
    expect(GREEK_ALPHA).toBe(0.3);
    expect(entry?.quad.color).toEqual([0.2, 0.4, 0.6, 0.3]);
    expect(entry && isGreekQuad(entry.quad)).toBe(true);
    expect([entry?.quad.u0, entry?.quad.v0, entry?.quad.u1, entry?.quad.v1]).toEqual(
      GREEK_PAGE_RECT,
    );
    expect(entry?.pageId).toBe(0);
  });
});
