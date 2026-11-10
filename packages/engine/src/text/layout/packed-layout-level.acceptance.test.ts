import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';
import { layoutText } from '@canvas/text';

import { FakeGlyphMeasurer } from './__fixtures__/fake-glyph-measurer.js';
import { packTextLayout, unpackTextLayout } from './packed-layout.js';

const STYLE: TextStyle = {
  fontFamily: 'Fake',
  fontSize: 20,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
};

describe('packed layout embedding levels', () => {
  it('round-trips level on every glyph, including zero, odd and nested even levels', () => {
    const runs: StyleRun[] = [{ length: 4, style: STYLE }];
    const base = layoutText('abcd', runs, null, new FakeGlyphMeasurer());
    const levels = [0, 1, 2, 3];
    const layout = {
      ...base,
      glyphs: base.glyphs.map((glyph, index) => ({ ...glyph, level: levels[index] ?? 0 })),
    };
    const restored = unpackTextLayout(packTextLayout(layout));
    expect(
      restored.glyphs.map((glyph) => (glyph as typeof glyph & { readonly level: number }).level),
    ).toEqual(levels);
    expect(restored).toEqual(layout);
  });
});
