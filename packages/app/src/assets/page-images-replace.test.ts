// Replacing an image with a file without creating an object (rule 3: an instance's
// image override): the file is read, drawn from its bytes, handed to the caller as an asset and
// uploaded for the objects the caller names.
import { describe, expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { settle } from './__fixtures__/manual-schedule.js';
import { BOARD, png, setUp } from './__fixtures__/page-images-setup.js';
import { NO_IMAGES_MESSAGE, PageImages } from './page-images.js';

describe('PageImages.replace', () => {
  it('reads a file, gives its asset to the caller, draws it at once and uploads it', async () => {
    const { images, service, toAdapter } = setUp();
    const { file, assetId } = png(3);
    const apply = vi.fn(() => ['inst' as ObjectId]);
    const notify = vi.fn();
    await images.replace(file, apply, notify);
    expect(apply).toHaveBeenCalledWith({ assetId, naturalSize: { width: 400, height: 200 } });
    expect(toAdapter.filter(({ type }) => type === 'local-image')).toHaveLength(1);
    expect(images.uploads.snapshot()).toMatchObject([{ assetId, objectIds: ['inst'] }]);
    await settle();
    expect(service.isLinked(assetId, BOARD)).toBe(true);
    expect(notify).not.toHaveBeenCalled();
  });

  it('uploads nothing when the caller could not use the asset', async () => {
    const { images, service } = setUp();
    await images.replace(png(4).file, () => undefined, vi.fn());
    await settle();
    expect(images.uploads.snapshot()).toEqual([]);
    expect(service.requests).toEqual([]);
  });

  it('refuses a file the board cannot take, saying why, and gives nothing', async () => {
    const { images, service } = setUp();
    const apply = vi.fn(() => [] as ObjectId[]);
    const notify = vi.fn();
    await images.replace(new File(['x'], 'notes.txt', { type: 'text/plain' }), apply, notify);
    expect(apply).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('“notes.txt” is not an image'));
    expect(service.requests).toEqual([]);
  });

  it('says the page has no images without an assets service, or does nothing once ended', async () => {
    const without = new PageImages(undefined);
    const notify = vi.fn();
    await without.replace(png(5).file, vi.fn(), notify);
    expect(notify).toHaveBeenCalledWith(NO_IMAGES_MESSAGE);
    without.destroy();
    const { images } = setUp();
    images.endSession();
    const apply = vi.fn();
    await images.replace(png(6).file, apply, vi.fn());
    expect(apply).not.toHaveBeenCalled();
  });
});
