import { MEMORY_CATEGORIES, type MemoryCategory } from '../diagnostics/memory-ledger.js';

const MIB = 1024 * 1024;

/** The GPU memory budget of a desktop, in bytes: 512 MiB. */
export const DESKTOP_BUDGET_BYTES = 512 * MIB;

/** The GPU memory budget of a phone or tablet, in bytes: 128 MiB. */
export const MOBILE_BUDGET_BYTES = 128 * MIB;

/** The budget of a GPU whose textures stop at 4096 px: an older or integrated part. */
const SMALL_GPU_BUDGET_BYTES = 256 * MIB;

/** Largest texture edge, in px, that still counts as a small GPU. */
const SMALL_GPU_MAX_TEXTURE_SIZE = 4096;

/** The budget never takes more than this share of the device's memory. */
const DEVICE_MEMORY_SHARE = 1 / 8;

/**
 * Each category's share of the total, in 64ths: image and video textures dominate,
 * as they dominate memory; glyph atlas pages and path meshes get an eighth each,
 * the scene's instance buffers most of the rest (50k objects of 40-byte records fit in 2 MiB,
 * so this is headroom) and uniforms a sliver. Offscreen layers take 6 from textures,
 * which go from 40 to 34. The shares sum to 64.
 */
const SHARES_IN_64THS: Readonly<Record<MemoryCategory, number>> = {
  instanceBuffers: 7,
  atlases: 8,
  textures: 34,
  meshes: 8,
  uniforms: 1,
  layers: 6,
};

/**
 * A phone or tablet's shares: glyph atlases take 10 64ths (20 MiB of 128) and path
 * meshes 6 (12 MiB), so the scene text atlas's own 7/8 (17.5 MiB) holds a 2048-texel page, the
 * page size it borrows texture memory in (smaller pages cost the GPU when a CJK board spreads its
 * glyphs over many); textures keep their 34.
 */
const MOBILE_SHARES_IN_64THS: Readonly<Record<MemoryCategory, number>> = {
  ...SHARES_IN_64THS,
  atlases: 10,
  meshes: 6,
};

/** What the budget is derived from: the browser's view of the device. */
export interface DeviceDescription {
  /**
   * `navigator.deviceMemory`: the device's RAM in GiB, rounded down to a power of two and capped
   * at 8 by the browser; `undefined` where the browser does not say (Safari, Firefox).
   */
  readonly deviceMemoryGb: number | undefined;
  /** The GPU's largest texture edge, in px (`GpuCapabilities.maxTextureSize`). */
  readonly maxTextureSize: number;
  /** Whether the device is a phone or tablet: the mobile device class (128 MiB). */
  readonly isMobile: boolean;
}

/** The two device classes the GPU memory budget is set by. */
export type DeviceClass = 'desktop' | 'mobile';

/**
 * How many bytes of GPU memory each category may hold on this device: a byte budget,
 * enforced. The texture manager evicts image levels to stay under `bytesByCategory.textures`; the
 * glyph atlas and the path meshes read their caps from `atlases` and `meshes`.
 * Plain data.
 */
export interface DeviceMemoryBudget {
  /** The device class the budget started from. */
  readonly deviceClass: DeviceClass;
  /** The whole budget, in bytes: the sum of `bytesByCategory`. */
  readonly totalBytes: number;
  /** Each category's cap, in whole bytes. */
  readonly bytesByCategory: Readonly<Record<MemoryCategory, number>>;
}

/**
 * The byte budget for a device: 512 MiB for a desktop and 128 MiB for a
 * phone, lowered to an eighth of the device's memory where the browser reports it, and to
 * 256 MiB for a GPU whose textures stop at 4096 px; then split over the categories (textures
 * 34 64ths, glyph atlases and meshes an eighth each, instance buffers seven 64ths, offscreen
 * layers six, uniforms one; on a phone or tablet glyph atlases 10 and meshes 6). Pure.
 *
 * @param device - The device's class, memory and texture limit.
 * @returns The budget per category, in whole bytes summing to the total.
 * @throws {RangeError} When `deviceMemoryGb` is given but not a positive number.
 */
export function budgetForDevice(device: DeviceDescription): DeviceMemoryBudget {
  const { deviceMemoryGb, maxTextureSize, isMobile } = device;
  if (deviceMemoryGb !== undefined && !(Number.isFinite(deviceMemoryGb) && deviceMemoryGb > 0)) {
    throw new RangeError(
      `A device memory is a positive number of GiB; received ${String(deviceMemoryGb)}.`,
    );
  }
  let totalBytes = isMobile ? MOBILE_BUDGET_BYTES : DESKTOP_BUDGET_BYTES;
  if (deviceMemoryGb !== undefined) {
    totalBytes = Math.min(
      totalBytes,
      Math.floor(deviceMemoryGb * 1024 * MIB * DEVICE_MEMORY_SHARE),
    );
  }
  if (maxTextureSize <= SMALL_GPU_MAX_TEXTURE_SIZE) {
    totalBytes = Math.min(totalBytes, SMALL_GPU_BUDGET_BYTES);
  }
  return {
    deviceClass: isMobile ? 'mobile' : 'desktop',
    totalBytes,
    bytesByCategory: splitBudget(totalBytes, isMobile ? MOBILE_SHARES_IN_64THS : SHARES_IN_64THS),
  };
}

/**
 * Splits a total over the categories by their shares; the rounding remainder goes to textures,
 * so the parts sum to the total exactly.
 *
 * @param totalBytes - The whole budget.
 * @param shares - Each category's share, in 64ths.
 * @returns Whole bytes per category.
 */
function splitBudget(
  totalBytes: number,
  shares: Readonly<Record<MemoryCategory, number>>,
): Record<MemoryCategory, number> {
  const parts = {} as Record<MemoryCategory, number>;
  let assigned = 0;
  for (const category of MEMORY_CATEGORIES) {
    const bytes = Math.floor((totalBytes * shares[category]) / 64);
    parts[category] = bytes;
    assigned += bytes;
  }
  parts.textures += totalBytes - assigned;
  return parts;
}
