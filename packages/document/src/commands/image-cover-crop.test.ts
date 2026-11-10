// The nightly sync fuzz (seed 39) refused an honest `replaceImage` as `invalid-object`
// on the crop. A resize may leave an image with no width or no height, and the cover crop of
// such a box divided by its zero aspect: a crop 0 wide, or NaN, which the schema refuses.
import { describe, expect, it } from 'vitest';

import { cropSchema } from '@canvas/schema';

import { coverCrop, replacedCrop } from './image-cover-crop.js';

const WHOLE = { x: 0, y: 0, width: 1, height: 1 };

describe('the cover crop of a box with no area', () => {
  it.each([
    ['no width', { width: 0, height: 60 }],
    ['no height', { width: 100, height: 0 }],
    ['neither', { width: 0, height: 0 }],
  ])('shows the whole image for a box with %s', (name, box) => {
    const natural = { width: 3000, height: 17 };
    expect(coverCrop(box, natural), name).toEqual(WHOLE);
    const replaced = replacedCrop({ x: 0.1, y: 0.2, width: 0.5, height: 0.5 }, box, natural);
    expect(cropSchema.safeParse(replaced).success, name).toBe(true);
  });

  it('still cuts a box with area on the long axis, centred', () => {
    expect(coverCrop({ width: 100, height: 100 }, { width: 400, height: 200 })).toEqual({
      x: 0.25,
      y: 0,
      width: 0.5,
      height: 1,
    });
  });
});
