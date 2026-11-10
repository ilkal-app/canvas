import { z } from 'zod';

import { rgbaSchema } from '../fields/color.js';
import { assetIdSchema } from '../ids/asset-id.js';

/**
 * The states an asset moves through: `uploading` until the service has
 * verified the uploaded bytes, `processing` while its pyramid is generated, then `ready`, or
 * `failed` when generation gave up.
 */
export const ASSET_STATUSES = ['uploading', 'processing', 'ready', 'failed'] as const;

/** Where an asset is in its life; one of {@link ASSET_STATUSES}. */
export type AssetStatus = (typeof ASSET_STATUSES)[number];

/**
 * The encodings of a generated image level: AVIF first, WebP when AVIF encoding of that level
 * failed.
 */
export const IMAGE_LEVEL_FORMATS = ['avif', 'webp'] as const;

/** The encoding of one generated level or tile; one of {@link IMAGE_LEVEL_FORMATS}. */
export type ImageLevelFormat = (typeof IMAGE_LEVEL_FORMATS)[number];

/**
 * The long edges, in px and ascending, of the resized levels generated for every image.
 * A level at least as large as the original is not generated: the
 * original is kept and serves full resolution.
 */
export const IMAGE_LEVEL_LONG_EDGES_PX = [128, 512, 2048, 4096] as const;

/**
 * The edge of a tile, in px, of the tile pyramid generated for originals whose long edge
 * exceeds the largest level.
 */
export const TILE_SIZE_PX = 256;

/** The longest blurhash an asset record carries: a 32-byte blurhash. */
export const MAX_BLURHASH_LENGTH = 32;

/** Whole milliseconds since the Unix epoch, UTC. */
const timestampSchema = z.number().int().nonnegative();

/** A URL the client can fetch directly, typically signed and short-lived. */
const urlSchema = z.url();

/** Validates one generated level of an image. */
export const assetLevelSchema = z
  .strictObject({
    /** The level's long edge in px; the short edge keeps the original's aspect ratio. */
    longEdgePx: z
      .number()
      .int()
      .positive()
      .describe("The level's long edge in px; the short edge keeps the aspect ratio."),
    /** How the level is encoded. */
    format: z.enum(IMAGE_LEVEL_FORMATS).describe('How the level is encoded: avif or webp.'),
    /** A signed, short-lived URL of the level's bytes; absent when not handed out. */
    url: urlSchema
      .optional()
      .describe("A signed, short-lived URL of the level's bytes; absent when not handed out."),
  })
  .describe('One generated level of an image.');

/** One generated level of an image. */
export type AssetLevel = z.output<typeof assetLevelSchema>;

/**
 * Validates the tile pyramid of an image whose long edge exceeds the largest level. Tile level
 * `z` (0 ≤ z < `levels`) is the original scaled by 2^(z − levels + 1), so the last level is
 * full resolution; its size is the natural size divided by 2^(levels − 1 − z), rounded up, cut
 * into `tileSizePx` squares by column `x` and row `y` from the top left, the last column and row
 * possibly narrower. Only levels whose long edge exceeds the largest resized level are tiled.
 */
export const assetTilesSchema = z
  .strictObject({
    /** The tile edge in px: always {@link TILE_SIZE_PX}. */
    tileSizePx: z.literal(TILE_SIZE_PX).describe('The tile edge in px: always 256.'),
    /** How many tile levels there are; the last is full resolution. */
    levels: z
      .number()
      .int()
      .positive()
      .describe('How many tile levels there are; the last is full resolution.'),
    /** How the tiles are encoded. */
    format: z.enum(IMAGE_LEVEL_FORMATS).describe('How the tiles are encoded: avif or webp.'),
    /** The tile URL with `{z}`, `{x}` and `{y}` placeholders; authenticated, redirects. */
    urlTemplate: z
      .string()
      .optional()
      .describe('The tile URL with {z}, {x} and {y} placeholders; authenticated, redirects.'),
  })
  .describe('The tile pyramid of an image larger than the largest level.');

/** The tile pyramid of an image larger than the largest level. */
export type AssetTiles = z.output<typeof assetTilesSchema>;

/**
 * Validates an asset record: what the assets service knows about one uploaded image, shared by the
 * service and the client's texture manager. The id is the SHA-256 of the original's bytes
 * (lowercase hex), so equal bytes are one asset. `levels` and `progress` grow while the asset is
 * `processing`, so a client can swap in each level as it appears; `naturalSize`, `blurhash` and
 * `averageColor` are null until the service has read the image.
 */
export const assetRecordSchema = z
  .strictObject({
    /** The asset id: the SHA-256 of the original's bytes, lowercase hex. */
    id: assetIdSchema,
    /** The original's media type, such as `image/png`. */
    mimeType: z
      .string()
      .regex(/^[a-z]+\/[a-z0-9.+-]+$/, 'a media type is type/subtype')
      .describe("The original's media type, such as image/png."),
    /** The original's size in bytes. */
    byteLength: z.number().int().positive().describe("The original's size in bytes."),
    /** The original's size in px, or null until the service has read it. */
    naturalSize: z
      .strictObject({
        /** Width in px. */
        width: z.number().int().positive().describe('Width in px.'),
        /** Height in px. */
        height: z.number().int().positive().describe('Height in px.'),
      })
      .nullable()
      .describe("The original's size in px, or null until the service has read it."),
    /** Where the asset is in its life. */
    status: z.enum(ASSET_STATUSES).describe('uploading, processing, ready or failed.'),
    /** The generated levels so far, ascending by long edge. */
    levels: z
      .array(assetLevelSchema)
      .describe('The generated levels so far, ascending by long edge.'),
    /** The tile pyramid, or null when the original needs none or it is not generated yet. */
    tiles: assetTilesSchema
      .nullable()
      .describe('The tile pyramid, or null when none is needed or it is not generated yet.'),
    /** A blurhash of at most 32 characters for an instant placeholder, or null until known. */
    blurhash: z
      .string()
      .min(6)
      .max(MAX_BLURHASH_LENGTH)
      .nullable()
      .describe('A blurhash of at most 32 characters for a placeholder, or null until known.'),
    /** The average colour for an instant placeholder, or null until known. */
    averageColor: rgbaSchema
      .nullable()
      .describe('The average colour for an instant placeholder, or null until known.'),
    /** How much of the pyramid is generated, from 0 to 1. */
    progress: z.number().min(0).max(1).describe('How much of the pyramid is generated, 0 to 1.'),
    /** When the asset was first declared, ms since the Unix epoch. */
    createdAt: timestampSchema.describe('When the asset was first declared, ms since the epoch.'),
    /** A signed, short-lived URL of the original, once it is uploaded and verified. */
    originalUrl: urlSchema
      .optional()
      .describe('A signed, short-lived URL of the original, once uploaded and verified.'),
  })
  .describe('What the assets service knows about one uploaded image.');

/** What the assets service knows about one uploaded image. */
export type AssetRecord = z.output<typeof assetRecordSchema>;
