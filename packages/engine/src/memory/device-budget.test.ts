import { describe, expect, it } from 'vitest';

import { MEMORY_CATEGORIES } from '../diagnostics/memory-ledger.js';

import { budgetForDevice, DESKTOP_BUDGET_BYTES, MOBILE_BUDGET_BYTES } from './device-budget.js';

const MIB = 1024 * 1024;

function sumOf(budget: ReturnType<typeof budgetForDevice>): number {
  return MEMORY_CATEGORIES.reduce((total, category) => total + budget.bytesByCategory[category], 0);
}

describe('budgetForDevice', () => {
  it('gives a desktop 512 MiB, split over every category', () => {
    const budget = budgetForDevice({ deviceMemoryGb: 8, maxTextureSize: 16384, isMobile: false });

    expect(DESKTOP_BUDGET_BYTES).toBe(512 * MIB);
    expect(budget.deviceClass).toBe('desktop');
    expect(budget.totalBytes).toBe(512 * MIB);
    expect(sumOf(budget)).toBe(512 * MIB);
    expect(budget.bytesByCategory.textures).toBe(272 * MIB);
    expect(budget.bytesByCategory.atlases).toBe(64 * MIB);
    expect(budget.bytesByCategory.meshes).toBe(64 * MIB);
    expect(budget.bytesByCategory.layers).toBe(48 * MIB);
  });

  it('gives a phone 128 MiB, glyph atlases taking 2 64ths from meshes', () => {
    const budget = budgetForDevice({ deviceMemoryGb: 4, maxTextureSize: 8192, isMobile: true });

    expect(MOBILE_BUDGET_BYTES).toBe(128 * MIB);
    expect(budget.deviceClass).toBe('mobile');
    expect(budget.totalBytes).toBe(128 * MIB);
    expect(sumOf(budget)).toBe(128 * MIB);
    expect(budget.bytesByCategory.textures).toBe(68 * MIB);
    expect(budget.bytesByCategory.layers).toBe(12 * MIB);
    // Glyph atlases 10 64ths and meshes 6, so the text atlas holds a 2048-texel page.
    expect(budget.bytesByCategory.atlases).toBe(20 * MIB);
    expect(budget.bytesByCategory.meshes).toBe(12 * MIB);
  });

  it('keeps the class budget when the device memory is unknown', () => {
    const budget = budgetForDevice({
      deviceMemoryGb: undefined,
      maxTextureSize: 8192,
      isMobile: false,
    });

    expect(budget.totalBytes).toBe(512 * MIB);
  });

  it('spends at most an eighth of a small device memory', () => {
    const twoGb = budgetForDevice({ deviceMemoryGb: 2, maxTextureSize: 8192, isMobile: false });
    const halfGb = budgetForDevice({ deviceMemoryGb: 0.5, maxTextureSize: 8192, isMobile: true });

    expect(twoGb.totalBytes).toBe(256 * MIB);
    expect(halfGb.totalBytes).toBe(64 * MIB);
    expect(sumOf(halfGb)).toBe(64 * MIB);
  });

  it('caps a GPU whose textures stop at 4096 px at 256 MiB', () => {
    const budget = budgetForDevice({ deviceMemoryGb: 8, maxTextureSize: 4096, isMobile: false });

    expect(budget.totalBytes).toBe(256 * MIB);
  });

  it('never gives a category a fraction of a byte', () => {
    const budget = budgetForDevice({ deviceMemoryGb: 0.25, maxTextureSize: 2048, isMobile: true });

    for (const category of MEMORY_CATEGORIES) {
      expect(Number.isInteger(budget.bytesByCategory[category])).toBe(true);
    }
    expect(sumOf(budget)).toBe(budget.totalBytes);
  });

  it('rejects a device memory that is not a positive number', () => {
    expect(() =>
      budgetForDevice({ deviceMemoryGb: 0, maxTextureSize: 8192, isMobile: false }),
    ).toThrow(RangeError);
    expect(() =>
      budgetForDevice({ deviceMemoryGb: Number.NaN, maxTextureSize: 8192, isMobile: false }),
    ).toThrow(RangeError);
  });
});
