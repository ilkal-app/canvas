import { describe, expect, it } from 'vitest';

import type { TextStyle } from '@canvas/schema';
import { layoutText, type TextLayout } from '@canvas/text';

import { GlyphAtlas } from '../atlas/glyph-atlas.js';
import { BASE_TIER, type GlyphTier } from '../atlas/glyph-tiers.js';
import { FakeGlyphMeasurer } from '../layout/__fixtures__/fake-glyph-measurer.js';
import { orderedGlyphQuads } from '../scene/ordered-glyph-quads.js';

import { buildGlyphQuads } from './glyph-quads.js';

const faceId = '400|n|Fake';
const instance = `${faceId}@wght=700`;
const placement = { originX: 0, originY: 0, scale: 1 };
const style: TextStyle = {
  fontFamily: 'Fake',
  fontSize: 64,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
};

function variableLayout(): TextLayout {
  const layout = layoutText('A', [{ length: 1, style }], null, new FakeGlyphMeasurer());
  const run = layout.runs[0];
  if (run === undefined) throw new Error('missing layout run');
  return { ...layout, runs: [{ ...run, variations: { wght: 700 } }] };
}

function bitmap(width: number) {
  return {
    field: 'sdf' as const,
    width,
    height: 4,
    pixels: new Uint8Array(width * 4),
    left: 0,
    top: 4,
    advance: width,
  };
}

interface RequestedFace {
  faceId: string;
  variations?: Readonly<Record<string, number>>;
}

describe('variable glyph quads', () => {
  it('the page builder requests a missing instance and ignores the default atlas entry', () => {
    const atlas = new GlyphAtlas();
    atlas.insert(faceId, 0x41, BASE_TIER, bitmap(3));
    const requests: [RequestedFace, number, GlyphTier][] = [];
    const layout = variableLayout();
    const result = buildGlyphQuads(layout, placement, atlas, {
      request: (face, glyph, tier) => requests.push([face, glyph, tier]),
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.[0]).toMatchObject({ faceId, variations: { wght: 700 } });
    expect(requests[0]?.slice(1)).toEqual([0x41, BASE_TIER]);
    expect(result.isComplete).toBe(false);
    expect(result.quadsByPage.size).toBe(0);

    const entry = atlas.insert(instance, 0x41, BASE_TIER, bitmap(9));
    const drawn = buildGlyphQuads(layout, placement, atlas);
    expect(drawn.isComplete).toBe(true);
    expect(drawn.quadsByPage.get(entry?.pageId ?? -1)?.[0]?.width).toBe(9);
  });

  it('the ordered builder requests a missing instance and uses its own atlas entry', () => {
    const atlas = new GlyphAtlas();
    atlas.insert(faceId, 0x41, BASE_TIER, bitmap(3));
    const requests: [RequestedFace, number, GlyphTier][] = [];
    const layout = variableLayout();
    const missing = orderedGlyphQuads(layout, placement, atlas, {
      request: (face, glyph, tier) => requests.push([face, glyph, tier]),
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.[0]).toMatchObject({ faceId, variations: { wght: 700 } });
    expect(requests[0]?.slice(1)).toEqual([0x41, BASE_TIER]);
    expect(missing.isComplete).toBe(false);
    expect(missing.quads).toEqual([undefined]);

    atlas.insert(instance, 0x41, BASE_TIER, bitmap(9));
    const drawn = orderedGlyphQuads(layout, placement, atlas);
    expect(drawn.isComplete).toBe(true);
    expect(drawn.quads[0]?.quad.width).toBe(9);
  });
});
