import { describe, expect, it } from 'vitest';

import type { AssetLevel } from '@canvas/schema';

import { canDecodeAvif, decodableLevels, decodableTiles } from './image-format-support.js';

const LEVELS: AssetLevel[] = [
  { longEdgePx: 512, format: 'avif' },
  { longEdgePx: 128, format: 'webp' },
  { longEdgePx: 128, format: 'avif' },
  { longEdgePx: 2048, format: 'webp' },
];

describe('canDecodeAvif', () => {
  it('decodes a tiny AVIF once and closes it', async () => {
    const decoded: string[] = [];
    let closed = 0;
    const decode = (blob: Blob) => {
      decoded.push(blob.type);
      return Promise.resolve({ close: () => (closed += 1) });
    };
    expect(await canDecodeAvif(decode)).toBe(true);
    expect([decoded, closed]).toEqual([['image/avif'], 1]);
  });

  it('is false when the decode fails or there is no decoder', async () => {
    expect(await canDecodeAvif(() => Promise.reject(new Error('no AV1')))).toBe(false);
    expect(await canDecodeAvif()).toBe(typeof createImageBitmap === 'function');
  });
});

describe('decodableLevels', () => {
  it('takes AVIF where it decodes, one level per edge, ascending', () => {
    expect(decodableLevels(LEVELS, true)).toEqual([
      { longEdgePx: 128, format: 'avif' },
      { longEdgePx: 512, format: 'avif' },
      { longEdgePx: 2048, format: 'webp' },
    ]);
  });

  it('falls back to WebP, leaving out edges made only in AVIF', () => {
    expect(decodableLevels(LEVELS, false)).toEqual([
      { longEdgePx: 128, format: 'webp' },
      { longEdgePx: 2048, format: 'webp' },
    ]);
  });
});

describe('decodableTiles', () => {
  it('keeps WebP tiles, and AVIF tiles only where AVIF decodes', () => {
    const webp = { tileSizePx: 256, levels: 2, format: 'webp' } as const;
    const avif = { ...webp, format: 'avif' } as const;
    expect(decodableTiles(webp, false)).toBe(webp);
    expect(decodableTiles(avif, true)).toBe(avif);
    expect(decodableTiles(avif, false)).toBeNull();
    expect(decodableTiles(null, true)).toBeNull();
  });
});
