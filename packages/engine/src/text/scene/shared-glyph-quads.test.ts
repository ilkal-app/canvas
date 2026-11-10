import { expect, it, vi } from 'vitest';

import { layoutText } from '@canvas/text';

import { GlyphAtlas } from '../atlas/glyph-atlas.js';
import { BASE_TIER, HIGH_TIER, type GlyphTier } from '../atlas/glyph-tiers.js';
import { FakeGlyphMeasurer } from '../layout/__fixtures__/fake-glyph-measurer.js';

import { orderedGlyphQuads } from './ordered-glyph-quads.js';
import { SharedGlyphQuads } from './shared-glyph-quads.js';

const FACE = '400|n|Fake';
const placement = { originX: 7.125, originY: -3.5, scale: 1 };
function layout() {
  return layoutText(
    'ABA C',
    [
      {
        length: 5,
        style: {
          fontFamily: 'Fake',
          fontSize: 16,
          color: [1, 0, 0, 1],
          weight: 400,
          italic: false,
        },
      },
    ],
    null,
    new FakeGlyphMeasurer(),
  );
}
function insert(atlas: GlyphAtlas, codepoint = 65) {
  atlas.insert(FACE, codepoint, BASE_TIER, {
    field: 'msdf',
    width: 20,
    height: 30,
    pixels: new Uint8Array(1800),
    left: -8,
    top: 40,
    advance: 38,
  });
}

it('reuses geometry while replaying every atlas lookup and missing request in order', () => {
  const atlas = new GlyphAtlas({ pageSize: 256 });
  insert(atlas);
  const lookup = vi.spyOn(atlas, 'lookup');
  const request = vi.fn();
  const cache = new SharedGlyphQuads(atlas, { request });
  const text = layout();
  const first = cache.get(text, placement);
  const lookups = lookup.mock.calls.slice();
  const requests = request.mock.calls.slice();
  lookup.mockClear();
  request.mockClear();
  expect(cache.get(text, placement)).toBe(first);
  expect(lookup.mock.calls).toEqual(lookups);
  expect(request.mock.calls).toEqual(requests);
  expect(first).toEqual(orderedGlyphQuads(text, placement, atlas));
});

it('invalidates for frame, atlas, origin, scale, layout and hysteresis changes', () => {
  const atlas = new GlyphAtlas({ pageSize: 256 });
  const cache = new SharedGlyphQuads(atlas, { request: vi.fn() });
  const text = layout();
  let previous = cache.get(text, placement);
  const verify = (next = placement) => {
    const result = cache.get(text, next);
    expect(result).not.toBe(previous);
    expect(result).toEqual(orderedGlyphQuads(text, next, atlas));
    previous = result;
  };
  cache.beginFrame();
  verify();
  insert(atlas);
  verify();
  verify({ ...placement, originX: 0 });
  verify({ ...placement, originX: -0 });
  verify({ ...placement, scale: 2 });
  const hysteresis = { ...placement, previousTiers: [HIGH_TIER] };
  expect(cache.get(text, hysteresis)).toEqual(orderedGlyphQuads(text, hysteresis, atlas));
  expect(cache.get(layout(), hysteresis)).not.toBe(cache.get(text, hysteresis));
});

it('copies prior tiers and refuses to retain a build whose atlas revision changed', () => {
  const atlas = new GlyphAtlas({ pageSize: 256 });
  const request = vi.fn(() => {
    insert(atlas);
  });
  const cache = new SharedGlyphQuads(atlas, { request });
  const text = layout();
  const first = cache.get(text, placement);
  expect(request).toHaveBeenCalled();
  request.mockImplementation(() => undefined);
  expect(cache.get(text, placement)).not.toBe(first);
  const previousTiers: GlyphTier[] = [BASE_TIER];
  const placed = { ...placement, previousTiers };
  const before = cache.get(text, placed);
  previousTiers[0] = HIGH_TIER;
  expect(cache.get(text, placed)).not.toBe(before);
  expect(cache.get(text, placed)).toEqual(orderedGlyphQuads(text, placed, atlas));
});
