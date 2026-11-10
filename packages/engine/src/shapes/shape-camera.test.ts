import { describe, expect, it } from 'vitest';

import { CAMERA_UNIFORM_BYTE_LENGTH } from '../scene/camera-uniform.js';

import { packShapeCamera, SHAPE_CAMERA_BYTE_LENGTH } from './shape-camera.js';

describe('packShapeCamera', () => {
  it("packs the camera as the engine's 32-byte camera uniform: clip map and device pixel", () => {
    const block = packShapeCamera({
      viewportWidthPx: 800,
      viewportHeightPx: 600,
      offsetXPx: -12.5,
      offsetYPx: 40,
      zoom: 2,
    });
    expect(block.byteLength).toBe(SHAPE_CAMERA_BYTE_LENGTH);
    expect(SHAPE_CAMERA_BYTE_LENGTH).toBe(CAMERA_UNIFORM_BYTE_LENGTH);
    // clip = world × scale + offset: world x 0 lands on pixel −12.5 of 800, y 0 on pixel 40 of 600.
    const expected = [4 / 800, -4 / 600, (-12.5 * 2) / 800 - 1, 1 - (40 * 2) / 600, 0.5, 0, 0, 0];
    expect(Array.from(block)).toHaveLength(expected.length);
    for (const [index, value] of expected.entries()) expect(block[index]).toBeCloseTo(value, 6);
  });

  it('rejects a zoom or viewport size that is not positive', () => {
    const camera = {
      viewportWidthPx: 800,
      viewportHeightPx: 600,
      offsetXPx: 0,
      offsetYPx: 0,
      zoom: 1,
    };
    expect(() => packShapeCamera({ ...camera, zoom: 0 })).toThrow(RangeError);
    expect(() => packShapeCamera({ ...camera, viewportWidthPx: 0 })).toThrow(RangeError);
    expect(() => packShapeCamera({ ...camera, viewportHeightPx: Number.NaN })).toThrow(RangeError);
  });
});
