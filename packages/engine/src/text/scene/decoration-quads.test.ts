import { describe, expect, it } from 'vitest';

import type { TextStyle } from '@canvas/schema';
import { layoutText } from '@canvas/text';

import { FakeGlyphMeasurer } from '../layout/__fixtures__/fake-glyph-measurer.js';

import { textObject } from './__fixtures__/text-objects.js';
import { decorationQuads, markerLayoutOf } from './decoration-quads.js';
import { textRecordCount } from './text-pass.js';

const BASE: TextStyle = {
  fontFamily: 'Fake',
  fontSize: 10,
  color: [0.2, 0.4, 0.6, 1],
  weight: 400,
  italic: false,
};
const measurer = new FakeGlyphMeasurer();

describe('decoration quads', () => {
  it('draws each decoration as a flat bar in its run’s colour, at least a device pixel thick', () => {
    const layout = layoutText(
      'abcd',
      [
        { length: 2, style: { ...BASE, underline: true } },
        { length: 2, style: { ...BASE, strikethrough: true } },
      ],
      null,
      measurer,
    );
    const bars = decorationQuads(layout, { x: 5, y: 7 }, 1).map(({ quad }) => quad);
    expect(bars).toHaveLength(2);
    const [underline, strike] = layout.decorations ?? [];
    expect(bars[0]).toMatchObject({ x: 5, width: 12, color: BASE.color, height: 1 });
    expect((bars[0]?.y ?? 0) + (bars[0]?.height ?? 0) / 2).toBeCloseTo(7 + (underline?.y ?? 0), 9);
    expect(bars[1]).toMatchObject({ x: 17, width: 12 });
    expect((bars[1]?.y ?? 0) + (bars[1]?.height ?? 0) / 2).toBeCloseTo(7 + (strike?.y ?? 0), 9);
    // Thicker than a device pixel at a high scale: the decoration's own thickness.
    expect(decorationQuads(layout, { x: 0, y: 0 }, 100)[0]?.quad.height).toBeCloseTo(0.5, 9);
  });

  it('leaves a link’s underline to the link and draws nothing for plain text', () => {
    const linked = layoutText(
      'ab',
      [{ length: 2, style: { ...BASE, link: 'https://example.com', underline: true } }],
      null,
      measurer,
    );
    expect(decorationQuads(linked, { x: 0, y: 0 }, 1)).toEqual([]);
    expect(
      decorationQuads(
        layoutText('ab', [{ length: 2, style: BASE }], null, measurer),
        { x: 0, y: 0 },
        1,
      ),
    ).toEqual([]);
  });

  it('gives a list’s markers a layout of their glyphs, one per layout', () => {
    const layout = layoutText('a\nb', [{ length: 3, style: BASE }], null, measurer, 'left', 'ltr', [
      { list: 'numbered' },
      { list: 'numbered' },
    ]);
    const markers = markerLayoutOf(layout);
    expect(markers?.glyphs.map((glyph) => String.fromCodePoint(glyph.codepoint))).toEqual([
      '1',
      '.',
      '2',
      '.',
    ]);
    expect(markerLayoutOf(layout)).toBe(markers);
    expect(
      markerLayoutOf(layoutText('a', [{ length: 1, style: BASE }], null, measurer)),
    ).toBeUndefined();
  });

  it('allocates records for decorations and markers', () => {
    const plain = textObject('t', 'ab\ncd');
    const base = textRecordCount(plain);
    const decorated = {
      ...plain,
      runs: [{ length: 5, style: { ...BASE, underline: true, strikethrough: true } }],
    };
    // Four decorated codepoints, each with an underline and a strikethrough.
    expect(textRecordCount(decorated)).toBe(base + 8);
    const listed = {
      ...plain,
      paragraphs: [{ list: 'numbered' as const }, { list: 'bullet' as const }],
    };
    // "1." and "•".
    expect(textRecordCount(listed)).toBe(base + 3);
  });
});
