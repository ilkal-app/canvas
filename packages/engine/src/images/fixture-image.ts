import type { UnitRect } from './tiles.js';

/** The first bytes of a fixture image: "CNVFIXIM". */
const SIGNATURE = [0x43, 0x4e, 0x56, 0x46, 0x49, 0x58, 0x49, 0x4d] as const;

/** Bytes in an encoded fixture image. */
const ENCODED_BYTES = 56;

/** Grid lines every eighth of the image, this fraction of a cell wide. */
const GRID_CELLS = 8;
const GRID_LINE_FRACTION = 0.04;

/** The level band covers the top 1/24 of the image. */
const LEVEL_BAND_HEIGHT = 1 / 24;

/**
 * The colours of the band a fixture image draws along its top edge, by the resolution it was
 * rendered at: long edges up to 128, 512, 2048 px, and above (the image pyramid's levels).
 * Golden scenes sample the band to prove which level a frame drew.
 */
export const FIXTURE_LEVEL_BAND_COLORS: readonly (readonly [number, number, number])[] = [
  [220, 40, 40],
  [40, 170, 60],
  [40, 80, 220],
  [200, 40, 200],
];

/** What a fixture image depicts. */
export interface FixtureImageDescription {
  /** The fixture source's seed. */
  readonly seed: number;
  /** Names the image (its asset id): different keys give different colours. */
  readonly assetKey: string;
  /** The encoded image's width, px: what a decoder reports. */
  readonly widthPx: number;
  /** The encoded image's height, px. */
  readonly heightPx: number;
  /** The part of the whole image it shows: the whole for a level, less for a tile. */
  readonly region: UnitRect;
}

/** A decoded fixture image's header. */
export interface FixtureImageHeader {
  /** The fixture source's seed. */
  readonly seed: number;
  /** A hash of the asset key, which sets the image's colours. */
  readonly assetHash: number;
  /** The encoded width, px. */
  readonly widthPx: number;
  /** The encoded height, px. */
  readonly heightPx: number;
  /** The part of the whole image shown. */
  readonly region: UnitRect;
}

/**
 * FNV-1a over a string's UTF-16 code units, mixed with a seed.
 *
 * @param seed - The seed.
 * @param text - The string.
 * @returns A 32-bit unsigned hash.
 */
function hashKey(seed: number, text: string): number {
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * Encodes a synthetic image as a few dozen bytes that the `decode` job renders at whatever size
 * it is asked for (`renderFixtureImage`), so tests, golden scenes and benchmarks run the whole
 * image path (fetch, decode job, upload, draw) without image files, and a 2048 px level costs
 * the fixture source nothing on the thread that renders. Pure.
 *
 * @param description - The image.
 * @returns The encoded bytes.
 */
export function encodeFixtureImage(description: FixtureImageDescription): ArrayBuffer {
  const buffer = new ArrayBuffer(ENCODED_BYTES);
  const view = new DataView(buffer);
  SIGNATURE.forEach((byte, index) => {
    view.setUint8(index, byte);
  });
  view.setUint32(8, description.seed >>> 0);
  view.setUint32(12, hashKey(description.seed, description.assetKey));
  view.setUint32(16, description.widthPx);
  view.setUint32(20, description.heightPx);
  const { region } = description;
  [region.minU, region.minV, region.maxU, region.maxV].forEach((value, index) => {
    view.setFloat64(24 + index * 8, value);
  });
  return buffer;
}

/**
 * Whether bytes are a fixture image (they start with its signature).
 *
 * @param bytes - Encoded image bytes.
 * @returns True for a fixture image.
 */
export function isFixtureImage(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength < ENCODED_BYTES) return false;
  const head = new Uint8Array(bytes, 0, SIGNATURE.length);
  return SIGNATURE.every((byte, index) => head[index] === byte);
}

/**
 * Reads a fixture image's header.
 *
 * @param bytes - The encoded fixture image.
 * @returns The header.
 * @throws {TypeError} When the bytes are not a fixture image.
 */
export function readFixtureImage(bytes: ArrayBuffer): FixtureImageHeader {
  if (!isFixtureImage(bytes)) throw new TypeError('The bytes are not a fixture image.');
  const view = new DataView(bytes);
  return {
    seed: view.getUint32(8),
    assetHash: view.getUint32(12),
    widthPx: view.getUint32(16),
    heightPx: view.getUint32(20),
    region: {
      minU: view.getFloat64(24),
      minV: view.getFloat64(32),
      maxU: view.getFloat64(40),
      maxV: view.getFloat64(48),
    },
  };
}

/**
 * Which level band a whole-image resolution falls in: 0 up to 128 px, 1 up to 512, 2 up to
 * 2048, 3 above.
 *
 * @param longEdgePx - The whole image's long edge at the rendered resolution, px.
 * @returns The index into {@link FIXTURE_LEVEL_BAND_COLORS}.
 */
export function fixtureLevelBand(longEdgePx: number): number {
  if (longEdgePx <= 128) return 0;
  if (longEdgePx <= 512) return 1;
  if (longEdgePx <= 2048) return 2;
  return 3;
}

/**
 * Renders a fixture image at a size, RGBA with straight alpha, rows top to bottom: a gradient
 * (red across, green down, blue from the asset), dark grid lines every eighth of the whole
 * image, and a band along the top edge coloured by the resolution rendered at
 * ({@link FIXTURE_LEVEL_BAND_COLORS}). A tile renders exactly the part of the whole image it
 * covers. Pure; runs in the `decode` job.
 *
 * @param bytes - The encoded fixture image.
 * @param widthPx - The output width, px.
 * @param heightPx - The output height, px.
 * @returns The pixels, `widthPx × heightPx × 4` bytes.
 */
export function renderFixtureImage(
  bytes: ArrayBuffer,
  widthPx: number,
  heightPx: number,
): Uint8Array<ArrayBuffer> {
  const { assetHash, region } = readFixtureImage(bytes);
  const spanU = region.maxU - region.minU;
  const spanV = region.maxV - region.minV;
  const band =
    FIXTURE_LEVEL_BAND_COLORS[fixtureLevelBand(Math.max(widthPx / spanU, heightPx / spanV))];
  const blue = 40 + (assetHash % 180);
  const rgba = new Uint8Array(widthPx * heightPx * 4);
  for (let y = 0; y < heightPx; y += 1) {
    const v = region.minV + ((y + 0.5) / heightPx) * spanV;
    const isBandRow = v < LEVEL_BAND_HEIGHT;
    const isGridRow = (v * GRID_CELLS) % 1 < GRID_LINE_FRACTION;
    for (let x = 0; x < widthPx; x += 1) {
      const u = region.minU + ((x + 0.5) / widthPx) * spanU;
      const offset = (y * widthPx + x) * 4;
      if (isBandRow && band !== undefined) {
        rgba[offset] = band[0];
        rgba[offset + 1] = band[1];
        rgba[offset + 2] = band[2];
      } else if (isGridRow || (u * GRID_CELLS) % 1 < GRID_LINE_FRACTION) {
        rgba[offset] = 30;
        rgba[offset + 1] = 30;
        rgba[offset + 2] = 30;
      } else {
        rgba[offset] = 60 + Math.floor(150 * u);
        rgba[offset + 1] = 60 + Math.floor(150 * v);
        rgba[offset + 2] = blue;
      }
      rgba[offset + 3] = 255;
    }
  }
  return rgba;
}
