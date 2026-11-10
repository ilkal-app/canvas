import { describe, expect, it } from 'vitest';

import {
  assertRenderTargetSize,
  isRenderTargetBottomUp,
  renderTargetByteLength,
} from './gpu-render-target.js';

describe('render target helpers', () => {
  it('accepts whole edges from 1 to the device limit', () => {
    expect(() => {
      assertRenderTargetSize({ width: 1, height: 64 }, 64);
    }).not.toThrow();
  });

  it('rejects an empty, oversized or fractional edge', () => {
    for (const [width, height] of [
      [0, 8],
      [8, 0],
      [65, 8],
      [8, 65],
      [8.5, 8],
      [Number.NaN, 8],
    ] as const) {
      expect(() => {
        assertRenderTargetSize({ width, height }, 64);
      }).toThrow(RangeError);
    }
  });

  it('counts the resolved colour at four bytes a pixel', () => {
    expect(renderTargetByteLength({ width: 32, height: 16 })).toBe(2048);
  });

  it('says only WebGL2 targets store their rows bottom-up', () => {
    expect(isRenderTargetBottomUp('webgl2')).toBe(true);
    expect(isRenderTargetBottomUp('webgpu')).toBe(false);
  });
});
