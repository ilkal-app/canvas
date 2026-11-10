import { describe, expect, it } from 'vitest';

import { encodeFixtureGif } from '../images/fixture-gif.js';
import { encodeFixtureImage, renderFixtureImage } from '../images/fixture-image.js';

import {
  createDecodeJobHandler,
  premultiplyAlpha,
  type DecodedImage,
  type ImageBitmapFactory,
} from './decode-job.js';
import { createDefaultJobHandlers } from './default-job-handlers.js';
import {
  createBrowserBitmapFactory,
  type WebImageBitmapFactory,
} from './web-worker/browser-bitmap-factory.js';

/** A bitmap factory that "decodes" any bytes to a fixed size and fills levels with their width. */
class FakeBitmapFactory implements ImageBitmapFactory {
  readonly decoded: string[] = [];
  readonly resized: string[] = [];
  closedCount = 0;

  constructor(private readonly size: { widthPx: number; heightPx: number }) {}

  decode(bytes: ArrayBuffer, mimeType: string): Promise<DecodedImage> {
    this.decoded.push(`${mimeType} ${String(bytes.byteLength)}`);
    const image: DecodedImage = {
      widthPx: this.size.widthPx,
      heightPx: this.size.heightPx,
      readPixels: (widthPx, heightPx) => {
        this.resized.push(`${String(widthPx)}×${String(heightPx)}`);
        return Promise.resolve(new Uint8Array(widthPx * heightPx * 4).fill(widthPx % 256));
      },
      close: () => {
        this.closedCount += 1;
      },
    };
    return Promise.resolve(image);
  }
}

describe('premultiplyAlpha', () => {
  it('scales colour by alpha and leaves opaque pixels alone', () => {
    const rgba = new Uint8Array([200, 100, 50, 255, 200, 100, 50, 128, 255, 255, 255, 0]);

    premultiplyAlpha(rgba);

    expect([...rgba]).toEqual([200, 100, 50, 255, 100, 50, 25, 128, 0, 0, 0, 0]);
  });
});

describe('the decode job', () => {
  it('hands back premultiplied pixels, so filtering never darkens transparent edges', async () => {
    const bitmaps = new FakeBitmapFactory({ widthPx: 128, heightPx: 96 });
    const decode = createDecodeJobHandler({ bitmaps });

    const { response } = await decode({
      assetId: 'logo',
      bytes: new ArrayBuffer(4),
      mimeType: 'image/png',
      longEdgesPx: [128],
    });

    // The fake fills every channel with 128: half-transparent grey, premultiplied to 64.
    expect([...(response.levels[0]?.rgba.slice(0, 4) ?? [])]).toEqual([64, 64, 64, 128]);
  });

  it('decodes once and resizes to every requested long edge, in request order', async () => {
    const bitmaps = new FakeBitmapFactory({ widthPx: 4000, heightPx: 3000 });
    const decode = createDecodeJobHandler({ bitmaps });
    const bytes = new ArrayBuffer(10);

    const { response, transfer } = await decode({
      assetId: 'photo',
      bytes,
      mimeType: 'image/avif',
      longEdgesPx: [512, 128],
    });

    expect(bitmaps.decoded).toEqual(['image/avif 10']);
    expect(bitmaps.resized).toEqual(['512×384', '128×96']);
    expect(response.assetId).toBe('photo');
    expect(response.levels.map(({ widthPx, heightPx }) => [widthPx, heightPx])).toEqual([
      [512, 384],
      [128, 96],
    ]);
    expect(response.levels[0]?.rgba[0]).toBe(0);
    expect(transfer).toEqual(response.levels.map(({ rgba }) => rgba.buffer));
    expect(bitmaps.closedCount).toBe(1);
  });

  it('never enlarges past the decoded size', async () => {
    const bitmaps = new FakeBitmapFactory({ widthPx: 300, heightPx: 200 });
    const decode = createDecodeJobHandler({ bitmaps });

    const { response } = await decode({
      assetId: 'small',
      bytes: new ArrayBuffer(4),
      mimeType: '',
      longEdgesPx: [512],
    });

    expect(response.levels.map(({ widthPx, heightPx }) => [widthPx, heightPx])).toEqual([
      [300, 200],
    ]);
  });

  it('closes the decoded image when a resize fails', async () => {
    const bitmaps = new FakeBitmapFactory({ widthPx: 300, heightPx: 200 });
    const failing: ImageBitmapFactory = {
      decode: async (bytes, mimeType) => ({
        ...(await bitmaps.decode(bytes, mimeType)),
        readPixels: () => Promise.reject(new Error('out of memory')),
        close: () => {
          bitmaps.closedCount += 1;
        },
      }),
    };

    await expect(
      createDecodeJobHandler({ bitmaps: failing })({
        assetId: 'x',
        bytes: new ArrayBuffer(4),
        mimeType: '',
        longEdgesPx: [128],
      }),
    ).rejects.toThrow('out of memory');
    expect(bitmaps.closedCount).toBe(1);
  });

  it('renders fixture images itself, without a bitmap factory', async () => {
    const bytes = encodeFixtureImage({
      seed: 2,
      assetKey: 'photo',
      widthPx: 1000,
      heightPx: 500,
      region: { minU: 0, minV: 0, maxU: 1, maxV: 1 },
    });

    const { response } = await createDecodeJobHandler()({
      assetId: 'photo',
      bytes,
      mimeType: '',
      longEdgesPx: [128],
    });

    expect(response.levels[0]).toMatchObject({ widthPx: 128, heightPx: 64 });
    expect(response.levels[0]?.rgba).toEqual(renderFixtureImage(bytes, 128, 64));
  });

  it('decodes a GIF’s first frame itself, without a bitmap factory', async () => {
    const bytes = encodeFixtureGif({
      widthPx: 4,
      heightPx: 2,
      palette: [
        [0, 128, 0],
        [255, 0, 0],
      ],
      frames: [{ indices: 0 }, { indices: 1 }],
    });
    const { response } = await createDecodeJobHandler()({
      assetId: 'gif',
      bytes,
      mimeType: 'image/gif',
      longEdgesPx: [2, 128],
    });
    expect(response.levels.map(({ widthPx, heightPx }) => [widthPx, heightPx])).toEqual([
      [2, 1],
      [4, 2],
    ]);
    expect([...(response.levels[1]?.rgba.subarray(0, 4) ?? [])]).toEqual([0, 128, 0, 255]);
  });

  it('fails an encoded image when no bitmap factory was given', async () => {
    await expect(
      createDecodeJobHandler()({
        assetId: 'photo',
        bytes: new ArrayBuffer(16),
        mimeType: 'image/webp',
        longEdgesPx: [128],
      }),
    ).rejects.toThrow('createImageBitmap');
  });

  it('is registered among the default handlers', () => {
    expect(createDefaultJobHandlers().decode).toBeTypeOf('function');
  });
});

describe('createBrowserBitmapFactory', () => {
  it('has the shape of the core bitmap factory', () => {
    // The web-worker project restates the core's types; this fails to compile if they drift.
    const browser: WebImageBitmapFactory = createBrowserBitmapFactory({
      createImageBitmap: () => Promise.reject(new Error('no browser here')),
    });
    const core: ImageBitmapFactory = browser;

    expect(Object.keys(core)).toEqual(['decode']);
  });
});
