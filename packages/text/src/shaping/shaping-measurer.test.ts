import { describe, expect, it } from 'vitest';

import { createMetricsMeasurer } from '../layout/glyph-measurer.js';

import { acceptanceFont } from './__fixtures__/shaping-fonts.js';
import { loadShaper } from './shaper.js';
import { createShapingMeasurer } from './shaping-measurer.js';

describe('createShapingMeasurer', () => {
  it('answers per-codepoint questions as the metrics measurer does', async () => {
    const font = acceptanceFont('dm-sans');
    const shaping = createShapingMeasurer(await loadShaper(), [font]);
    const metrics = createMetricsMeasurer([font.metrics]);
    const faceId = shaping.faceIdOf({
      fontFamily: 'DM Sans',
      fontSize: 12,
      color: 'ink',
      weight: 400,
      italic: false,
    });
    expect(shaping.advance(faceId, 0x41)).toBe(metrics.advance(faceId, 0x41));
    expect(shaping.kerning(faceId, 0x41, 0x56)).toBe(metrics.kerning(faceId, 0x41, 0x56));
    expect(shaping.lineMetrics(faceId)).toEqual(metrics.lineMetrics(faceId));
  });

  it('refuses to shape with a face it has no file for', async () => {
    const shaping = createShapingMeasurer(await loadShaper(), [acceptanceFont('dm-sans')]);
    expect(() => shaping.shape?.('Unknown|400|normal', 'a', 0, 1)).toThrow(RangeError);
  });

  it('never shapes with another file loaded for the same face id', async () => {
    const shaper = await loadShaper();
    const garamond = acceptanceFont('eb-garamond');
    const dmSans = acceptanceFont('dm-sans');
    // The same face (and id) twice, with other bytes: the second measurer must not reuse the
    // HarfBuzz face the first one made.
    const first = createShapingMeasurer(shaper, [garamond]);
    const second = createShapingMeasurer(shaper, [
      { metrics: garamond.metrics, bytes: dmSans.bytes },
    ]);
    const faceId = first.faceIdOf({
      fontFamily: 'EB Garamond',
      fontSize: 12,
      color: 'ink',
      weight: 400,
      italic: false,
    });
    const advanceOf = (shaped: ReturnType<NonNullable<typeof first.shape>> | undefined) =>
      (shaped?.glyphs ?? []).reduce((sum, glyph) => sum + glyph.advance, 0);
    const garamondWidth = advanceOf(first.shape?.(faceId, 'office', 0, 6));
    const dmSansWidth = advanceOf(second.shape?.(faceId, 'office', 0, 6));
    expect(dmSansWidth).not.toBeCloseTo(garamondWidth, 6);
    // A shaping id names the bytes: the same id reuses the face.
    const named = createShapingMeasurer(shaper, [{ ...dmSans, shapingId: 'dm-sans#test' }]);
    const again = createShapingMeasurer(shaper, [{ ...dmSans, shapingId: 'dm-sans#test' }]);
    const dmSansId = named.faceIdOf({
      fontFamily: 'DM Sans',
      fontSize: 12,
      color: 'ink',
      weight: 400,
      italic: false,
    });
    expect(advanceOf(again.shape?.(dmSansId, 'office', 0, 6))).toBe(
      advanceOf(named.shape?.(dmSansId, 'office', 0, 6)),
    );
  });
});
