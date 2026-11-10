// Written before the code; (): a link keeps its run's colour.
// CONTRACT: linked runs carry a flag and their own colour without moving glyphs. Deliberately not
// asserted: URL storage or link activation.
import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import { FakeGlyphMeasurer } from './__fixtures__/fake-glyph-measurer.js';
import { layoutText } from './layout-text.js';
import type { LayoutRun } from './text-layout.js';

const BASE: TextStyle = {
  fontFamily: 'Fake',
  fontSize: 10,
  color: 'ink',
  weight: 400,
  italic: false,
};
const TEXT = 'Read guide now';
const LINK = 'https://example.com/guide';
const measurer = new FakeGlyphMeasurer();

function runs(linkedStyle: TextStyle): StyleRun[] {
  return [
    { length: 5, style: BASE },
    { length: 5, style: linkedStyle },
    { length: 4, style: BASE },
  ];
}

describe('layoutText linked runs', () => {
  it('flags only linked runs, carries no URL, and keeps linked ink as ink', () => {
    const layout = layoutText(TEXT, runs({ ...BASE, link: LINK }), null, measurer);
    expect(layout.runs.map((run) => (run as LayoutRun & { isLink?: true }).isLink)).toEqual([
      undefined,
      true,
      undefined,
    ]);
    expect(layout.runs[1]?.color).toBe('ink');
    expect(JSON.stringify(layout.runs)).not.toContain(LINK);
  });

  it.each([[[0.2, 0.4, 0.6, 1] as TextStyle['color']], [{ token: 'surface' }]])(
    'keeps an explicitly coloured linked run at its own colour',
    (color) => {
      const layout = layoutText(TEXT, runs({ ...BASE, color, link: LINK }), null, measurer);
      expect(layout.runs[1]).toMatchObject({ isLink: true, color });
    },
  );

  it('keeps line breaks and every glyph position when a link is added', () => {
    const plain = layoutText(TEXT, runs(BASE), 60, measurer);
    const linked = layoutText(TEXT, runs({ ...BASE, link: LINK }), 60, measurer);
    expect(linked.lines).toEqual(plain.lines);
    expect(linked.glyphs).toEqual(plain.glyphs);
    expect(linked.runs.map(({ faceId, fontSize }) => ({ faceId, fontSize }))).toEqual(
      plain.runs.map(({ faceId, fontSize }) => ({ faceId, fontSize })),
    );
  });
});
