import { describe, expect, it } from 'vitest';

import type { BoardObject, TextStyle } from '@canvas/schema';
import { layoutText } from '@canvas/text';

import { FakeGlyphMeasurer } from '../layout/__fixtures__/fake-glyph-measurer.js';

import { textObject } from './__fixtures__/text-objects.js';
import { linkUnderlineQuads } from './link-underline.js';
import { textRecordCount } from './text-pass.js';

const BASE: TextStyle = {
  fontFamily: 'Fake',
  fontSize: 10,
  color: [0.2, 0.4, 0.6, 1],
  weight: 400,
  italic: false,
};
const LINK = 'https://example.com/a';
const measurer = new FakeGlyphMeasurer();

describe('link underlines', () => {
  it('gives each font size its own bar, at its own place and thickness', () => {
    const layout = layoutText(
      'abcd',
      [
        { length: 2, style: { ...BASE, fontSize: 8, link: LINK } },
        { length: 2, style: { ...BASE, fontSize: 96, link: LINK } },
      ],
      null,
      measurer,
    );
    const bars = linkUnderlineQuads(layout, { x: 0, y: 0 }, 100).quads.map(({ quad }) => quad);
    expect(bars).toHaveLength(2);
    const baseline = layout.lines[0]?.baseline ?? 0;
    expect(bars[0]?.y).toBeCloseTo(baseline + 0.8, 9);
    expect(bars[0]?.height).toBeCloseTo(0.48, 9);
    expect(bars[1]?.y).toBeCloseTo(baseline + 9.6, 9);
    expect(bars[1]?.height).toBeCloseTo(5.76, 9);
    expect((bars[0]?.x ?? 0) + (bars[0]?.width ?? 0)).toBeCloseTo(bars[1]?.x ?? -1, 9);
  });

  it('budgets a record for a linked space that underlines on its own', () => {
    const runs = [
      { length: 1, style: { ...BASE, link: LINK } },
      { length: 1, style: BASE },
    ];
    const layout = layoutText(' a', runs, null, measurer);
    const bars = linkUnderlineQuads(layout, { x: 0, y: 0 }, 1).quads;
    expect(bars).toHaveLength(1);
    const object = textObject('t', ' a', { runs }) as BoardObject;
    // One glyph record for "a" and one for the space's underline.
    expect(textRecordCount(object)).toBeGreaterThanOrEqual(1 + bars.length);
  });
});
