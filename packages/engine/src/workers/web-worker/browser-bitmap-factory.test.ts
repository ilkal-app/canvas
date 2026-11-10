import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBrowserBitmapFactory, type BitmapScope } from './browser-bitmap-factory.js';

/** A stand-in `ImageBitmap`: its size, and whether it was closed. */
class FakeBitmap {
  isClosed = false;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  close(): void {
    this.isClosed = true;
  }
}

/** What the fake `OffscreenCanvas` saw drawn, and whether it offers a 2d context. */
const canvases = { drawn: [] as FakeBitmap[], hasContext: true };

/** A stand-in `OffscreenCanvas` whose pixels are one byte per channel set to its width. */
class FakeOffscreenCanvas {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  getContext(): unknown {
    if (!canvases.hasContext) return null;
    return {
      drawImage: (image: FakeBitmap) => canvases.drawn.push(image),
      getImageData: (x: number, y: number, width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4).fill(this.width),
      }),
    };
  }
}

/**
 * A scope whose `createImageBitmap` decodes any blob to `decoded` and resizes to what it is asked.
 *
 * @param decoded - The decoded size.
 * @param decoded.width - Its width, px.
 * @param decoded.height - Its height, px.
 * @returns The scope, the calls it took and the bitmaps it made.
 */
function scopeOf(decoded: { width: number; height: number }) {
  const calls: { source: unknown; options: ImageBitmapOptions | undefined }[] = [];
  const bitmaps: FakeBitmap[] = [];
  const scope = {
    createImageBitmap: (source: unknown, options?: ImageBitmapOptions) => {
      calls.push({ source, options });
      const bitmap =
        source instanceof Blob
          ? new FakeBitmap(decoded.width, decoded.height)
          : new FakeBitmap(options?.resizeWidth ?? 0, options?.resizeHeight ?? 0);
      bitmaps.push(bitmap);
      return Promise.resolve(bitmap as unknown as ImageBitmap);
    },
  } as unknown as BitmapScope;
  return { scope, calls, bitmaps };
}

afterEach(() => {
  vi.unstubAllGlobals();
  canvases.drawn = [];
  canvases.hasContext = true;
});

describe('createBrowserBitmapFactory', () => {
  it('decodes a file with its media type and reads it at its own size without resizing', async () => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    const { scope, calls, bitmaps } = scopeOf({ width: 4, height: 2 });

    const image = await createBrowserBitmapFactory(scope).decode(new ArrayBuffer(8), 'image/png');
    const pixels = await image.readPixels(4, 2);

    expect([image.widthPx, image.heightPx]).toEqual([4, 2]);
    expect(calls).toHaveLength(1);
    expect((calls[0]?.source as Blob).type).toBe('image/png');
    expect(pixels).toHaveLength(4 * 2 * 4);
    expect(canvases.drawn).toEqual([bitmaps[0]]);
    image.close();
    expect(bitmaps[0]?.isClosed).toBe(true);
  });

  it('resizes with createImageBitmap at high quality, then frees the resized copy', async () => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    const { scope, calls, bitmaps } = scopeOf({ width: 400, height: 200 });

    const image = await createBrowserBitmapFactory(scope).decode(new ArrayBuffer(8), '');
    const pixels = await image.readPixels(128, 64);

    expect((calls[0]?.source as Blob).type).toBe('');
    expect(calls[1]?.options).toEqual({
      resizeWidth: 128,
      resizeHeight: 64,
      resizeQuality: 'high',
    });
    expect(pixels[0]).toBe(128);
    expect(bitmaps.map(({ isClosed }) => isClosed)).toEqual([false, true]);
  });

  it('refuses when the OffscreenCanvas offers no 2d context', async () => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    canvases.hasContext = false;
    const { scope } = scopeOf({ width: 4, height: 4 });

    const image = await createBrowserBitmapFactory(scope).decode(new ArrayBuffer(8), '');

    await expect(image.readPixels(4, 4)).rejects.toThrow('no 2d context');
  });
});
