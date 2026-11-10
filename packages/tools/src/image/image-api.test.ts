import { describe, expect, it } from 'vitest';

import { dragCrop } from './crop-geometry.js';
import { CropMode } from './crop-mode.js';
import * as imageApi from './image-api.js';
import { placeImages } from './image-placement.js';

describe('the image area’s API', () => {
  it('re-exports the placement, crop geometry and the image modes as they are', () => {
    expect(imageApi.placeImages).toBe(placeImages);
    expect(imageApi.dragCrop).toBe(dragCrop);
    expect(imageApi.CropMode).toBe(CropMode);
    expect(typeof imageApi.ImageMode).toBe('function');
  });
});
