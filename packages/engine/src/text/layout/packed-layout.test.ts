import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';
import { layoutText } from '@canvas/text';

import { FakeGlyphMeasurer } from './__fixtures__/fake-glyph-measurer.js';
import { packTextLayout, unpackTextLayout } from './packed-layout.js';

const S: TextStyle = {
  fontFamily: 'Fake',
  fontSize: 10,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
};
const runs: StyleRun[] = [
  { length: 4, style: S },
  { length: 7, style: { ...S, fontSize: 20.5, color: [1, 0, 0, 0.5] } },
];

describe('packTextLayout', () => {
  it('round-trips a layout through typed arrays exactly', () => {
    const layout = layoutText(
      'ab \u{1F600}\ncd efgh',
      runs,
      30.25,
      new FakeGlyphMeasurer(),
      'center',
    );
    const packed = packTextLayout(layout);
    expect(unpackTextLayout(packed)).toEqual(layout);
  });

  it('round-trips a shaped glyph’s id and cluster end, and a glyph without an id', () => {
    const layout = layoutText('ab', [{ length: 2, style: S }], null, new FakeGlyphMeasurer());
    const [first, second] = layout.glyphs;
    if (first === undefined || second === undefined) throw new Error('Expected two glyphs.');
    const shaped = { ...layout, glyphs: [{ ...first, glyphId: 924, end: 2 }, second] };
    expect(unpackTextLayout(packTextLayout(shaped))).toEqual(shaped);
    expect(second.glyphId).toBeNull();
  });

  it('keeps glyphs and lines in two buffers the job can transfer', () => {
    const packed = packTextLayout(
      layoutText('ab', [{ length: 2, style: S }], null, new FakeGlyphMeasurer()),
    );
    // Nine fields a glyph: the seven before shaping, its cluster's end and its glyph id.
    expect(packed.glyphs.byteLength).toBe(2 * 10 * 8);
    expect(packed.lines.byteLength).toBe(10 * 8);
    expect(packed.glyphs).not.toBe(packed.lines);
  });
});
