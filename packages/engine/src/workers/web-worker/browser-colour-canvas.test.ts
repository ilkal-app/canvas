import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBrowserColourCanvas } from './browser-colour-canvas.js';

/** A stand-in `OffscreenCanvas`: its size. */
class FakeOffscreenCanvas {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createBrowserColourCanvas', () => {
  it('makes OffscreenCanvases of the asked size', () => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    const canvas = createBrowserColourCanvas({ createImageBitmap: vi.fn() }).create(3, 4);
    expect(canvas).toBeInstanceOf(FakeOffscreenCanvas);
    expect([canvas.width, canvas.height]).toEqual([3, 4]);
  });

  it('decodes a strike as a PNG blob with createImageBitmap', async () => {
    const bitmap = { width: 1, height: 1 } as ImageBitmap;
    const createImageBitmap = vi.fn<(image: ImageBitmapSource) => Promise<ImageBitmap>>(() =>
      Promise.resolve(bitmap),
    );
    const png = new Uint8Array([137, 80, 78, 71]);
    expect(await createBrowserColourCanvas({ createImageBitmap }).decodePng(png)).toBe(bitmap);
    const blob = createImageBitmap.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe('image/png');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(png);
  });
});
