import { describe, expect, it } from 'vitest';

import { GlyphAtlas } from './glyph-atlas.js';
import { glyphFaceOf } from './glyph-key.js';
import { BASE_TIER } from './glyph-tiers.js';

const faceId = '400|n|Corpus Sans Variable';

describe('variable glyph face identity', () => {
  it('keeps the default face string and sorts coordinates for stable instance strings', () => {
    expect(glyphFaceOf({ faceId })).toBe(faceId);
    expect(glyphFaceOf({ faceId, variations: {} })).toBe(faceId);
    expect(glyphFaceOf({ faceId, variations: { wght: 700, wdth: 90 } })).toBe(
      `${faceId}@wdth=90;wght=700`,
    );
    expect(glyphFaceOf({ faceId, variations: { wdth: 90, wght: 700 } })).toBe(
      glyphFaceOf({ faceId, variations: { wght: 700, wdth: 90 } }),
    );
    expect(glyphFaceOf({ faceId, variations: { wght: 550 } })).not.toBe(
      glyphFaceOf({ faceId, variations: { wght: 700 } }),
    );
  });

  it('keeps atlas entries of two instances separate from each other and the default', () => {
    const atlas = new GlyphAtlas();
    const medium = glyphFaceOf({ faceId, variations: { wght: 550 } });
    const bold = glyphFaceOf({ faceId, variations: { wght: 700 } });
    const bitmap = {
      field: 'sdf' as const,
      width: 2,
      height: 2,
      pixels: new Uint8Array(4),
      left: 0,
      top: 2,
      advance: 2,
    };
    const entry = atlas.insert(bold, 0x41, BASE_TIER, bitmap);

    expect(entry).toBeDefined();
    expect(atlas.lookup(bold, 0x41, BASE_TIER)).toBe(entry);
    expect(atlas.lookup(faceId, 0x41, BASE_TIER)).toBeUndefined();
    expect(atlas.lookup(medium, 0x41, BASE_TIER)).toBeUndefined();
    expect(atlas.insert(medium, 0x41, BASE_TIER, bitmap)).not.toBe(entry);
    expect(atlas.memory().glyphCount).toBe(2);
  });
});
