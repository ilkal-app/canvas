import { describe, expect, it } from 'vitest';

import {
  ASSET_STATUSES,
  assetRecordSchema,
  IMAGE_LEVEL_FORMATS,
  IMAGE_LEVEL_LONG_EDGES_PX,
  MAX_BLURHASH_LENGTH,
  TILE_SIZE_PX,
} from './asset-record.js';

const HASH = 'a'.repeat(64);

/** A record as the assets service sends it once every level is stored. */
const READY = {
  id: HASH,
  mimeType: 'image/png',
  byteLength: 1_234_567,
  naturalSize: { width: 6000, height: 4000 },
  status: 'ready',
  levels: [
    { longEdgePx: 128, format: 'avif', url: 'https://assets.example/levels/128' },
    { longEdgePx: 512, format: 'webp', url: 'https://assets.example/levels/512' },
  ],
  tiles: {
    tileSizePx: 256,
    levels: 1,
    format: 'webp',
    urlTemplate: 'https://assets.example/assets/x/tiles/{z}/{x}/{y}',
  },
  blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
  averageColor: [0.2, 0.4, 0.6, 1],
  progress: 1,
  createdAt: 1_760_000_000_000,
  originalUrl: 'https://assets.example/original',
};

/** A record right after `POST /assets`: nothing known but what the client declared. */
const UPLOADING = {
  id: HASH,
  mimeType: 'image/jpeg',
  byteLength: 10,
  naturalSize: null,
  status: 'uploading',
  levels: [],
  tiles: null,
  blurhash: null,
  averageColor: null,
  progress: 0,
  createdAt: 1_760_000_000_000,
};

describe('asset record constants', () => {
  it('names the four statuses an asset moves through', () => {
    expect(ASSET_STATUSES).toEqual(['uploading', 'processing', 'ready', 'failed']);
  });

  it('keeps the level sizes, tile size and formats of the image pipeline', () => {
    expect(IMAGE_LEVEL_LONG_EDGES_PX).toEqual([128, 512, 2048, 4096]);
    expect(TILE_SIZE_PX).toBe(256);
    expect(IMAGE_LEVEL_FORMATS).toEqual(['avif', 'webp']);
    expect(MAX_BLURHASH_LENGTH).toBe(32);
  });
});

describe('assetRecordSchema', () => {
  it('accepts a ready record with levels, tiles and placeholders', () => {
    expect(assetRecordSchema.parse(READY)).toEqual(READY);
  });

  it('accepts an uploading record whose derived fields are still null', () => {
    expect(assetRecordSchema.safeParse(UPLOADING).success).toBe(true);
  });

  it('accepts a level whose url is not given', () => {
    const record = { ...READY, levels: [{ longEdgePx: 128, format: 'avif' }] };
    expect(assetRecordSchema.safeParse(record).success).toBe(true);
  });

  it.each([
    ['a progress above 1', { progress: 1.5 }],
    ['a negative progress', { progress: -0.1 }],
    ['an unknown status', { status: 'done' }],
    ['a level format other than AVIF or WebP', { levels: [{ longEdgePx: 128, format: 'png' }] }],
    ['a tile size other than 256 px', { tiles: { tileSizePx: 512, levels: 1, format: 'webp' } }],
    ['a blurhash longer than 32 characters', { blurhash: 'x'.repeat(33) }],
    ['an asset id with a slash', { id: 'a/b' }],
    ['a mime type that is not type/subtype', { mimeType: 'png' }],
    ['a fractional byte length', { byteLength: 1.5 }],
    ['an unknown key', { extra: true }],
  ])('rejects %s', (label, change) => {
    expect(assetRecordSchema.safeParse({ ...READY, ...change }).success, label).toBe(false);
  });
});
