import { describe, expect, it } from 'vitest';

import {
  MAX_IMAGE_BYTES,
  refuseImageFile,
  tooManyPixelsNotice,
  unreadableImageNotice,
} from './image-files.js';

const PHOTO = { name: 'photo.jpg', type: 'image/jpeg', size: 1000 };

describe('refuseImageFile', () => {
  it('takes the five image types browsers decode, at most 100 MB', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'IMAGE/GIF']) {
      expect(refuseImageFile({ ...PHOTO, type })).toBeUndefined();
    }
    expect(refuseImageFile({ ...PHOTO, size: MAX_IMAGE_BYTES })).toBeUndefined();
  });

  it('refuses other types, larger and empty files, with a sentence naming the file', () => {
    expect(refuseImageFile({ ...PHOTO, type: 'image/heic' })).toBe(
      '“photo.jpg” is not an image the board can show: use JPEG, PNG, WebP, AVIF or GIF.',
    );
    expect(refuseImageFile({ ...PHOTO, name: '', type: '' })).toMatch(/^The image is not/);
    expect(refuseImageFile({ ...PHOTO, size: MAX_IMAGE_BYTES + 1 })).toBe(
      '“photo.jpg” is larger than 100 MB, the most the board takes.',
    );
    expect(refuseImageFile({ ...PHOTO, size: 0 })).toBe('“photo.jpg” is empty.');
  });
});

describe('board upload size', () => {
  it('uses the board limit inclusively and falls back to 100 MB', () => {
    const free = 25 * 1024 * 1024;
    expect(refuseImageFile({ ...PHOTO, size: free }, free)).toBeUndefined();
    expect(refuseImageFile({ ...PHOTO, size: free + 1 }, free)).toBe(
      "“photo.jpg” is larger than 25 MB, the most this board's plan takes.",
    );
    expect(refuseImageFile({ ...PHOTO, size: MAX_IMAGE_BYTES })).toBeUndefined();
    expect(refuseImageFile({ ...PHOTO, size: MAX_IMAGE_BYTES + 1 })).toBe(
      '“photo.jpg” is larger than 100 MB, the most the board takes.',
    );
  });
});

describe('tooManyPixelsNotice', () => {
  it('names the file and the 64-megapixel limit', () => {
    expect(tooManyPixelsNotice(PHOTO)).toBe(
      '“photo.jpg” has more than 64 megapixels, the most the board takes.',
    );
  });
});

describe('unreadableImageNotice', () => {
  it('names the file', () => {
    expect(unreadableImageNotice(PHOTO)).toBe('“photo.jpg” could not be read as an image.');
  });
});
