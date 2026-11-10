import { describe, expect, it } from 'vitest';

import {
  encodeFixtureImage,
  FIXTURE_LEVEL_BAND_COLORS,
  fixtureLevelBand,
  isFixtureImage,
  readFixtureImage,
  renderFixtureImage,
} from './fixture-image.js';

const WHOLE = { minU: 0, minV: 0, maxU: 1, maxV: 1 };

function pixel(rgba: Uint8Array, width: number, x: number, y: number): number[] {
  const offset = (y * width + x) * 4;
  return [...rgba.subarray(offset, offset + 4)];
}

describe('fixture images', () => {
  const bytes = encodeFixtureImage({
    seed: 7,
    assetKey: 'photo-1',
    widthPx: 400,
    heightPx: 300,
    region: WHOLE,
  });

  it('are recognised by their signature and nothing else is', () => {
    expect(isFixtureImage(bytes)).toBe(true);
    expect(isFixtureImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toBe(false);
    expect(isFixtureImage(new ArrayBuffer(0))).toBe(false);
  });

  it('read back what was encoded', () => {
    expect(readFixtureImage(bytes)).toMatchObject({ seed: 7, widthPx: 400, heightPx: 300 });
  });

  it('render the same pixels for the same description', () => {
    const first = renderFixtureImage(bytes, 64, 48);
    const second = renderFixtureImage(bytes, 64, 48);

    expect(first).toEqual(second);
    expect(first.length).toBe(64 * 48 * 4);
  });

  it('render opaque pixels that differ between assets', () => {
    const other = encodeFixtureImage({
      seed: 7,
      assetKey: 'photo-2',
      widthPx: 400,
      heightPx: 300,
      region: WHOLE,
    });
    const first = renderFixtureImage(bytes, 16, 12);
    const second = renderFixtureImage(other, 16, 12);

    expect(pixel(first, 16, 8, 8)[3]).toBe(255);
    expect(pixel(first, 16, 8, 8)).not.toEqual(pixel(second, 16, 8, 8));
  });

  it('mark the level they were rendered at in a band along the top', () => {
    // Rendered at 128 px long, the whole image is the 128 level; at 2048, the 2048 level.
    const small = renderFixtureImage(bytes, 128, 96);
    const large = renderFixtureImage(bytes, 2048, 1536);

    expect(fixtureLevelBand(128)).toBe(0);
    expect(fixtureLevelBand(2048)).toBe(2);
    expect(pixel(small, 128, 64, 1)).toEqual([...(FIXTURE_LEVEL_BAND_COLORS[0] ?? []), 255]);
    expect(pixel(large, 2048, 1024, 10)).toEqual([...(FIXTURE_LEVEL_BAND_COLORS[2] ?? []), 255]);
  });

  it('render a tile as the matching part of the whole image', () => {
    const whole = renderFixtureImage(bytes, 400, 300);
    const tile = encodeFixtureImage({
      seed: 7,
      assetKey: 'photo-1',
      widthPx: 100,
      heightPx: 100,
      region: { minU: 0.5, minV: 0.5, maxU: 0.75, maxV: 5 / 6 },
    });

    // A tile of the same resolution is a crop of the whole: pixel (200, 150) of the whole.
    expect(pixel(renderFixtureImage(tile, 100, 100), 100, 0, 0)).toEqual(
      pixel(whole, 400, 200, 150),
    );
  });

  it('refuse bytes that are not a fixture image', () => {
    expect(() => readFixtureImage(new ArrayBuffer(8))).toThrow(TypeError);
  });
});
