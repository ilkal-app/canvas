import { describe, expect, it } from 'vitest';

import { acceptanceFont } from './__fixtures__/shaping-fonts.js';
import { loadShaper, shapeText, type Shaper } from './shaper.js';

describe('shapeText', () => {
  it('shapes nothing for an empty stretch, guessing its direction all the same', async () => {
    const shaper = await loadShaper();
    const face = shaper.face('unit-garamond', acceptanceFont('eb-garamond').bytes);
    expect(shapeText(shaper, face, 'office', 2, 2)).toEqual({ direction: 'ltr', glyphs: [] });
  });

  it('reads context only within the stretch’s paragraph and reports clusters in the whole text', async () => {
    const shaper = await loadShaper();
    const face = shaper.face('unit-garamond', acceptanceFont('eb-garamond').bytes);
    const alone = shapeText(shaper, face, 'office', 0, 6);
    const text = 'first\noffice\nlast';
    const inside = shapeText(shaper, face, text, 6, 12);
    expect(inside.glyphs.map(({ glyphId }) => glyphId)).toEqual(
      alone.glyphs.map(({ glyphId }) => glyphId),
    );
    expect(inside.glyphs.map(({ cluster }) => cluster)).toEqual(
      alone.glyphs.map(({ cluster }) => cluster + 6),
    );
    // The last paragraph runs to the end of the text.
    const last = shapeText(shaper, face, text, 13, 17);
    expect(last.glyphs.map(({ cluster }) => cluster)).toEqual([13, 14, 15, 16]);
  });

  it('refuses a face the shaper did not make, and a shaper loadShaper did not make', async () => {
    const shaper = await loadShaper();
    const face = shaper.face('unit-garamond', acceptanceFont('eb-garamond').bytes);
    expect(() =>
      shapeText(
        shaper,
        { id: 'never-made', unitsPerEm: 1000, variations: {}, variationKey: '' },
        'a',
        0,
        1,
      ),
    ).toThrow(RangeError);
    const imitation: Shaper = {
      version: shaper.version,
      retainedFaceBytes: 0,
      face: () => face,
      outline: () => ({ contours: [] }),
      hasColourGlyphs: () => false,
      colourGlyph: () => undefined,
    };
    expect(() => shapeText(imitation, face, 'a', 0, 1)).toThrow(TypeError);
  });
});
