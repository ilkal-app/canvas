/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';
import {
  createFontMetrics,
  createMetricsMeasurer,
  createShapingMeasurer,
  layoutText,
  loadShaper,
  parseFont,
  type TextLayout,
} from '@canvas/text';

import { buildGlyphQuads } from '../renderer/glyph-quads.js';

import { GlyphAtlas } from './glyph-atlas.js';
import type { GlyphBitmap } from './glyph-bitmap.js';
import { glyphIdOfKey, glyphKeyOf, type GlyphKey } from './glyph-key.js';
import { BASE_TIER, type GlyphTier } from './glyph-tiers.js';

const STYLE: TextStyle = {
  fontFamily: 'EB Garamond',
  fontSize: 20,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
};
const PLACEMENT = { originX: 7, originY: 11, scale: 1 };

function font() {
  const bytes = readFileSync(
    new URL('../../../../app/assets/fonts/library/ebgaramond/400.ttf', import.meta.url),
  );
  return {
    bytes,
    metrics: createFontMetrics(
      { family: 'EB Garamond', weight: 400, isItalic: false },
      parseFont(bytes),
    ),
  };
}

function runs(text: string): StyleRun[] {
  return [{ length: text.length, style: STYLE }];
}

function bitmap(): GlyphBitmap {
  return {
    field: 'sdf',
    width: 2,
    height: 3,
    pixels: new Uint8Array(6),
    left: -1,
    top: 4,
    advance: 5,
  };
}

function requestsOf(layout: TextLayout, atlas: GlyphAtlas) {
  const requests: [string, GlyphKey, GlyphTier][] = [];
  const requester = {
    request(face: { readonly faceId: string }, key: GlyphKey, tier: GlyphTier): void {
      requests.push([face.faceId, key, tier]);
    },
  };
  const quads = buildGlyphQuads(layout, PLACEMENT, atlas, requester);
  return { requests, quads };
}

describe('glyph keys by glyph id', () => {
  it('round trips shaped glyph ids including .notdef and preserves codepoint zero', () => {
    for (const glyphId of [0, 1, 42, 65_535]) {
      const key = glyphKeyOf({ codepoint: 0x66, glyphId });
      expect(key).toBe(-1 - glyphId);
      expect(glyphIdOfKey(key)).toBe(glyphId);
    }
    for (const codepoint of [0, 0x66, 0x10ffff]) {
      expect(glyphKeyOf({ codepoint, glyphId: null })).toBe(codepoint);
      expect(glyphIdOfKey(codepoint)).toBeUndefined();
    }
  });

  it('requests the real EB Garamond ffi ligature by glyph id and draws each shaped glyph', async () => {
    const face = font();
    const layout = layoutText(
      'office',
      runs('office'),
      null,
      createShapingMeasurer(await loadShaper(), [face]),
    );
    const ligature = layout.glyphs.find((glyph) => glyph.index === 1 && glyph.end === 4);
    if (ligature?.glyphId == null) throw new Error('EB Garamond did not shape ffi');
    const atlas = new GlyphAtlas();
    const first = requestsOf(layout, atlas);
    const faceId = layout.runs[0]?.faceId;
    const distinct = [...new Set(layout.glyphs.map(glyphKeyOf))];
    expect(first.requests).toEqual(distinct.map((key) => [faceId, key, BASE_TIER]));
    const ligatureKey = glyphKeyOf(ligature);
    expect(ligatureKey).toBeLessThan(0);
    expect(first.requests.filter(([, key]) => key === ligatureKey)).toHaveLength(1);
    expect(first.requests.some(([, key]) => key === ligature.codepoint)).toBe(false);
    if (faceId === undefined) throw new Error('missing layout face');
    for (const key of distinct) atlas.insert(faceId, key, BASE_TIER, bitmap());
    const second = requestsOf(layout, atlas);
    expect(second.requests).toEqual([]);
    expect(second.quads.isComplete).toBe(true);
    expect([...second.quads.quadsByPage.values()].flat()).toHaveLength(layout.glyphs.length);
  });

  it('keeps shaped .notdef separate from codepoint zero in the atlas', () => {
    const atlas = new GlyphAtlas();
    const codepoint = atlas.insert('face', 0, BASE_TIER, bitmap());
    const shaped = atlas.insert('face', -1, BASE_TIER, bitmap());
    expect(atlas.memory().glyphCount).toBe(2);
    expect(atlas.lookup('face', 0, BASE_TIER)).toBe(codepoint);
    expect(atlas.lookup('face', -1, BASE_TIER)).toBe(shaped);
  });

  it('skips a shaped space by codepoint even though it has a glyph id', async () => {
    const face = font();
    const layout = layoutText(
      'office ',
      runs('office '),
      null,
      createShapingMeasurer(await loadShaper(), [face]),
    );
    const space = layout.glyphs.find((glyph) => glyph.codepoint === 0x20);
    if (space?.glyphId == null) throw new Error('missing shaped space');
    const { requests } = requestsOf(layout, new GlyphAtlas());
    expect(requests.map(([, key]) => key)).not.toContain(glyphKeyOf(space));
    expect(requests).toHaveLength(layout.glyphs.length - 1);
  });

  it('keeps metrics layouts byte-identical to a codepoint-only atlas and quad reference', () => {
    const face = font();
    const layout = layoutText('A A', runs('A A'), null, createMetricsMeasurer([face.metrics]));
    const atlas = new GlyphAtlas();
    const visible = layout.glyphs.filter((glyph) => glyph.codepoint !== 0x20);
    const referenceKeys = visible.map((glyph) => glyph.codepoint);
    const faceId = layout.runs[0]?.faceId;
    if (faceId === undefined) throw new Error('missing layout face');
    const referenceAtlasKeys = referenceKeys.map(
      (key) => `${String(BASE_TIER)}|${String(key)}|${faceId}`,
    );
    expect(referenceAtlasKeys).toEqual(['64|65|400|n|EB Garamond', '64|65|400|n|EB Garamond']);
    expect(layout.glyphs.every((glyph) => glyph.glyphId === null)).toBe(true);
    expect(visible.map(glyphKeyOf)).toEqual(referenceKeys);
    const before = requestsOf(layout, atlas);
    expect(before.requests).toEqual(referenceKeys.map((key) => [faceId, key, BASE_TIER]));

    const firstKey = referenceKeys[0];
    if (firstKey === undefined) throw new Error('missing reference glyph');
    const entry = atlas.insert(faceId, firstKey, BASE_TIER, bitmap());
    expect(atlas.lookup(faceId, firstKey, BASE_TIER)).toBe(entry);
    expect(atlas.memory().glyphCount).toBe(1);
    const after = requestsOf(layout, atlas);
    expect(after.requests).toEqual([]);
    const expectedQuads = visible.map((glyph) => ({
      x: PLACEMENT.originX + glyph.x + bitmap().left * (STYLE.fontSize / BASE_TIER),
      y: PLACEMENT.originY + glyph.y - bitmap().top * (STYLE.fontSize / BASE_TIER),
      width: bitmap().width * (STYLE.fontSize / BASE_TIER),
      height: bitmap().height * (STYLE.fontSize / BASE_TIER),
      u0: entry?.u0,
      v0: entry?.v0,
      u1: entry?.u1,
      v1: entry?.v1,
      color: STYLE.color,
    }));
    expect([...after.quads.quadsByPage.values()].flat()).toEqual(expectedQuads);
  });
});
