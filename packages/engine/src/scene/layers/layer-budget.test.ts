import { describe, expect, it } from 'vitest';

import { budgetForDevice } from '../../memory/device-budget.js';

import {
  bucketEdge,
  DEFAULT_LAYER_BYTE_BUDGET,
  LAYER_TILE_PX,
  layerScratchBytes,
  layerScratchBytesPerTexel,
  layerTargetBytes,
  layerTargetExtent,
  layerTileEdge,
  layerTiles,
} from './layer-budget.js';

const MIB = 1024 * 1024;

describe('layer budget', () => {
  it('rounds target edges up to 64 px buckets, at most the tile', () => {
    expect([1, 63, 64, 65, 128, 129].map((px) => bucketEdge(px, 1024))).toEqual([
      64, 64, 64, 128, 128, 192,
    ]);
    expect(bucketEdge(1000, 1024)).toBe(1024);
    expect(bucketEdge(1000, 512)).toBe(512);
  });

  it('keeps a 1024 px tile on a desktop and halves it on a phone, never past the device', () => {
    const desktop = budgetForDevice({
      deviceMemoryGb: undefined,
      maxTextureSize: 8192,
      isMobile: false,
    });
    const phone = budgetForDevice({
      deviceMemoryGb: undefined,
      maxTextureSize: 8192,
      isMobile: true,
    });
    expect(DEFAULT_LAYER_BYTE_BUDGET).toBe(desktop.bytesByCategory.layers);
    expect(layerTileEdge(desktop.bytesByCategory.layers, 8192)).toBe(LAYER_TILE_PX);
    expect(layerTileEdge(phone.bytesByCategory.layers, 8192)).toBe(512);
    expect(layerTileEdge(0, 8192)).toBe(256);
    expect(layerTileEdge(DEFAULT_LAYER_BYTE_BUDGET, 512)).toBe(512);
    expect(layerScratchBytes({ width: 1024, height: 1024 })).toBe(32 * MIB);
  });

  it('keeps a layer that fits a tile whole, and cuts a larger one along the canvas grid', () => {
    const small = { x: 19, y: 7, width: 400, height: 1024 };
    expect(layerTiles(small, 1024)).toEqual([small]);
    const wide = layerTiles({ x: 0, y: 0, width: 2201, height: 1301 }, 1024);
    expect(wide).toHaveLength(6);
    expect(wide.map(({ x, width }) => [x, width]).slice(0, 3)).toEqual([
      [0, 1024],
      [1024, 1024],
      [2048, 153],
    ]);
    expect(
      wide.map(({ y, height }) => [y, height]).filter((unused, index) => index % 3 === 0),
    ).toEqual([
      [0, 1024],
      [1024, 277],
    ]);
    const offset = layerTiles({ x: 19, y: 19, width: 2202, height: 300 }, 1024);
    expect(offset.map(({ x, width, y, height }) => [x, width, y, height])).toEqual([
      [19, 1005, 19, 300],
      [1024, 1024, 19, 300],
      [2048, 173, 19, 300],
    ]);
  });

  it('costs each tile’s bucketed colour and its composite uniform', () => {
    expect(layerTargetBytes({ x: 0, y: 0, width: 100, height: 70 }, 1024)).toBe(128 * 128 * 4 + 32);
    expect(layerTargetBytes({ x: 0, y: 0, width: 1100, height: 10 }, 1024)).toBe(
      1024 * 64 * 4 + 32 + 128 * 64 * 4 + 32,
    );
  });

  it('charges the scratch as each backend allocates it, at its targets’ extent', () => {
    const rate = (backendName: 'webgpu' | 'webgl2', sampleCount: number) =>
      layerScratchBytesPerTexel({ backendName, sampleCount });
    // 4× MSAA: colour, stencil8 and a resolve on WebGPU; colour and depth-stencil on WebGL2.
    expect(rate('webgpu', 4)).toBe(24);
    expect(rate('webgl2', 4)).toBe(32);
    expect(rate('webgpu', 1)).toBe(5);
    expect(rate('webgl2', 1)).toBe(8);
    expect(rate('webgl2', 0)).toBe(8);
    expect(layerScratchBytes({ width: 256, height: 192 }, 24)).toBe(256 * 192 * 24);
    expect(layerTargetExtent({ x: 0, y: 0, width: 100, height: 70 }, 1024)).toEqual({
      width: 128,
      height: 128,
    });
    expect(layerTargetExtent({ x: 0, y: 0, width: 1100, height: 10 }, 1024)).toEqual({
      width: 1024,
      height: 64,
    });
  });
});
