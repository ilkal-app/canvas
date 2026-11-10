import { describe, expect, it } from 'vitest';

import { bytesPerTexel, resolveTextureWrite } from './texture-write.js';

const ATLAS_PAGE = { format: 'rgba8unorm', width: 16, height: 8 } as const;

describe('bytesPerTexel', () => {
  it('is 4 for rgba8unorm and 1 for r8unorm', () => {
    expect([bytesPerTexel('rgba8unorm'), bytesPerTexel('r8unorm')]).toEqual([4, 1]);
  });
});

describe('resolveTextureWrite', () => {
  it('keeps absolute float32 placement texels at sixteen bytes each', () => {
    const table = { format: 'rgba32float', width: 4, height: 2 } as const;
    expect(bytesPerTexel(table.format)).toBe(16);
    expect(
      resolveTextureWrite(
        table,
        128,
        { x: 1, y: 0, width: 2, height: 2 },
        {
          bytesPerRow: 64,
          byteOffset: 16,
        },
      ),
    ).toEqual({
      region: { x: 1, y: 0, width: 2, height: 2 },
      byteOffset: 16,
      bytesPerRow: 64,
      rowLengthTexels: 4,
    });
    expect(() => resolveTextureWrite(table, 127)).toThrow(/source holds/);
  });

  it('writes the whole texture from packed rows when no region or layout is given', () => {
    expect(resolveTextureWrite(ATLAS_PAGE, 16 * 8 * 4)).toEqual({
      region: { x: 0, y: 0, width: 16, height: 8 },
      byteOffset: 0,
      bytesPerRow: 64,
      rowLengthTexels: 16,
    });
  });

  it('uploads a dirty region straight out of a whole page, like the prototype syncPage', () => {
    const region = { x: 4, y: 2, width: 3, height: 2 };
    const pageBytesPerRow = 16 * 4;
    const layout = { bytesPerRow: pageBytesPerRow, byteOffset: 2 * pageBytesPerRow + 4 * 4 };
    const resolved = resolveTextureWrite(ATLAS_PAGE, 16 * 8 * 4, region, layout);
    expect(resolved.rowLengthTexels).toBe(16);
    expect(resolved.byteOffset).toBe(144);
  });

  it('packs single-byte rows for r8unorm without padding', () => {
    const mask = { format: 'r8unorm', width: 3, height: 3 } as const;
    expect(resolveTextureWrite(mask, 9).bytesPerRow).toBe(3);
  });

  it('rejects a region that leaves the texture', () => {
    expect(() =>
      resolveTextureWrite(ATLAS_PAGE, 4096, { x: 15, y: 0, width: 2, height: 1 }),
    ).toThrow(/leaves/);
  });

  it('rejects a source too short for the region', () => {
    expect(() => resolveTextureWrite(ATLAS_PAGE, 16 * 8 * 4 - 1)).toThrow(/source holds/);
  });

  it('rejects a row stride that is not a whole number of texels', () => {
    const region = { x: 0, y: 0, width: 2, height: 2 };
    expect(() => resolveTextureWrite(ATLAS_PAGE, 4096, region, { bytesPerRow: 10 })).toThrow(
      /bytesPerRow/,
    );
  });
});
