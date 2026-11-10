import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';
import { layoutText } from '@canvas/text';

import { GlyphAtlas } from '../atlas/glyph-atlas.js';
import type { GlyphBitmap } from '../atlas/glyph-bitmap.js';
import type { GlyphFace } from '../atlas/glyph-key.js';
import { BASE_TIER, HIGH_TIER, MAX_TIER, type GlyphTier } from '../atlas/glyph-tiers.js';
import { FakeGlyphMeasurer } from '../layout/__fixtures__/fake-glyph-measurer.js';

import { buildGlyphQuads } from './glyph-quads.js';

const FACE = '400|n|Fake';
const style: TextStyle = {
  fontFamily: 'Fake',
  fontSize: 16,
  color: [1, 0, 0, 1],
  weight: 400,
  italic: false,
};
const runs = (text: string): StyleRun[] => [{ length: text.length, style }];
const layoutOf = (text: string) => layoutText(text, runs(text), null, new FakeGlyphMeasurer());

function bitmap(field: 'msdf' | 'sdf' = 'msdf', width = 20, height = 30): GlyphBitmap {
  return {
    field,
    width,
    height,
    pixels: new Uint8Array(width * height * (field === 'msdf' ? 3 : 1)),
    left: -8,
    top: 40,
    advance: 38,
  };
}

class RecordingRequester {
  readonly requests: [number, GlyphTier][] = [];

  request(face: GlyphFace, codepoint: number, tier: GlyphTier): void {
    expect(face.faceId).toBe(FACE);
    this.requests.push([codepoint, tier]);
  }
}

describe('buildGlyphQuads', () => {
  it('places each glyph by its bitmap metrics scaled from the tier to the font size', () => {
    const atlas = new GlyphAtlas({ pageSize: 256 });
    const entry = atlas.insert(FACE, 0x41, BASE_TIER, bitmap());
    const layout = layoutOf('A');
    const quads = buildGlyphQuads(layout, { originX: 100, originY: 50, scale: 1 }, atlas);
    const scale = 16 / BASE_TIER;
    const glyph = layout.glyphs[0];
    expect(quads.isComplete).toBe(true);
    expect(quads.tiers).toEqual([BASE_TIER]);
    expect(quads.quadsByPage.get(0)).toEqual([
      {
        x: 100 + (glyph?.x ?? 0) - 8 * scale,
        y: 50 + (glyph?.y ?? 0) - 40 * scale,
        width: 20 * scale,
        height: 30 * scale,
        u0: entry?.u0,
        v0: entry?.v0,
        u1: entry?.u1,
        v1: entry?.v1,
        color: [1, 0, 0, 1],
      },
    ]);
  });

  it('draws nothing for spaces and blank glyphs, and asks for neither again', () => {
    const atlas = new GlyphAtlas({ pageSize: 256 });
    atlas.insert(FACE, 0x2e, BASE_TIER, bitmap('msdf', 0, 0));
    const requester = new RecordingRequester();
    const quads = buildGlyphQuads(
      layoutOf(' .'),
      { originX: 0, originY: 0, scale: 1 },
      atlas,
      requester,
    );
    expect(quads.quadsByPage.size).toBe(0);
    expect(requester.requests).toEqual([]);
    expect(quads.isComplete).toBe(true);
  });

  it('asks for a missing glyph at its tier and at the base tier when no tier has it', () => {
    const atlas = new GlyphAtlas({ pageSize: 1024 });
    const requester = new RecordingRequester();
    const quads = buildGlyphQuads(
      layoutOf('A'),
      { originX: 0, originY: 0, scale: 40 },
      atlas,
      requester,
    );
    expect(quads.tiers).toEqual([MAX_TIER]);
    expect(quads.isComplete).toBe(false);
    expect(quads.quadsByPage.size).toBe(0);
    expect(requester.requests).toEqual([
      [0x41, MAX_TIER],
      [0x41, BASE_TIER],
    ]);
  });

  it('draws from the highest lower tier while the wanted one is generated', () => {
    const atlas = new GlyphAtlas({ pageSize: 1024 });
    atlas.insert(FACE, 0x41, BASE_TIER, bitmap());
    const high = atlas.insert(FACE, 0x41, HIGH_TIER, bitmap('sdf', 80, 120));
    const requester = new RecordingRequester();
    const quads = buildGlyphQuads(
      layoutOf('A'),
      { originX: 0, originY: 0, scale: 40 },
      atlas,
      requester,
    );
    expect(quads.isComplete).toBe(false);
    expect(requester.requests).toEqual([[0x41, MAX_TIER]]);
    const [quad] = quads.quadsByPage.get(high?.pageId ?? -1) ?? [];
    expect(quad?.width).toBe(80 * (16 / HIGH_TIER));
  });

  it('keeps the previous tier within the hysteresis margin', () => {
    const atlas = new GlyphAtlas({ pageSize: 1024 });
    // 16 world units at scale 8.5 is 136 device px per em: past 128, within its 10% margin.
    const layout = layoutOf('A');
    expect(buildGlyphQuads(layout, { originX: 0, originY: 0, scale: 8.5 }, atlas).tiers).toEqual([
      HIGH_TIER,
    ]);
    const kept = buildGlyphQuads(
      layout,
      { originX: 0, originY: 0, scale: 8.5, previousTiers: [BASE_TIER] },
      atlas,
    );
    expect(kept.tiers).toEqual([BASE_TIER]);
  });

  it('groups quads by page', () => {
    const atlas = new GlyphAtlas({ pageSize: 256 });
    atlas.insert(FACE, 0x41, BASE_TIER, bitmap('msdf'));
    atlas.insert(FACE, 0x42, BASE_TIER, bitmap('sdf'));
    atlas.insert(FACE, 0x43, BASE_TIER, bitmap('msdf'));
    const quads = buildGlyphQuads(layoutOf('ABC'), { originX: 0, originY: 0, scale: 1 }, atlas);
    expect([...quads.quadsByPage].map(([pageId, pageQuads]) => [pageId, pageQuads.length])).toEqual(
      [
        [0, 2],
        [1, 1],
      ],
    );
  });
});
