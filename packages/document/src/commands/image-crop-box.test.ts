import { describe, expect, it } from 'vitest';

import { croppedImageBox, fullImageBox } from './image-crop-box.js';

const IMAGE = {
  x: 900,
  y: -300,
  rotation: 0,
  width: 400,
  height: 300,
  crop: { x: 0.1, y: 0, width: 0.8, height: 1 },
  naturalSize: { width: 4000, height: 2400 },
};

/** The 4000 × 3000 photo of the reviewer's probe, whole, in a 400 × 300 box. */
const PROBE = {
  x: 0,
  y: 0,
  rotation: 0,
  width: 400,
  height: 300,
  crop: { x: 0, y: 0, width: 1, height: 1 },
  naturalSize: { width: 4000, height: 3000 },
};

describe('croppedImageBox', () => {
  it('keeps the part still shown where it was, at the same scale', () => {
    expect(croppedImageBox(IMAGE, { x: 0.3, y: 0.5, width: 0.4, height: 0.5 })).toEqual({
      x: 1000,
      y: -150,
      width: 200,
      height: 150,
    });
  });

  it('grows the box back to the whole image when the crop is reset', () => {
    expect(croppedImageBox(IMAGE, { x: 0, y: 0, width: 1, height: 1 })).toEqual({
      x: 850,
      y: -300,
      width: 500,
      height: 300,
    });
  });

  it('moves the origin along the turned axes of a rotated image', () => {
    const turned = { ...IMAGE, x: 0, y: 0, rotation: Math.PI / 2 };
    const box = croppedImageBox(turned, { x: 0.3, y: 0.5, width: 0.4, height: 0.5 });
    // 100 units right and 150 down in the image's frame is 150 left and 100 down on the board.
    expect(box.x).toBeCloseTo(-150);
    expect(box.y).toBeCloseTo(100);
    expect(box.width).toBeCloseTo(200);
    expect(box.height).toBeCloseTo(150);
  });

  it('leaves the box as it is for the same crop', () => {
    expect(croppedImageBox(IMAGE, IMAGE.crop)).toEqual({
      x: 900,
      y: -300,
      width: 400,
      height: 300,
    });
  });

  it('gives a box with the new crop’s aspect when a merge left the old box off the old one’s', () => {
    // The left half's crop (2:3) left in the whole photo's 400 × 300 box draws 200 × 300,
    // centred; cropping it again measures from there.
    const merged = { ...PROBE, crop: { x: 0, y: 0, width: 0.5, height: 1 } };
    expect(croppedImageBox(merged, merged.crop)).toEqual({ x: 100, y: 0, width: 200, height: 300 });
    expect(croppedImageBox(merged, PROBE.crop)).toEqual({ x: 100, y: 0, width: 400, height: 300 });
  });
});

describe('fullImageBox', () => {
  it('is the whole image in the object’s own frame, the box inside it', () => {
    expect(fullImageBox(IMAGE)).toEqual({ x: -50, y: 0, width: 500, height: 300 });
  });

  it('is measured from where the image draws in a box off the crop’s aspect', () => {
    // The whole 4:3 photo left in a 200 × 300 box draws 200 × 150, centred down.
    expect(fullImageBox({ ...PROBE, width: 200 })).toEqual({
      x: 0,
      y: 75,
      width: 200,
      height: 150,
    });
  });
});
