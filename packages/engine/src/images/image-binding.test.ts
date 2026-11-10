import { describe, expect, it } from 'vitest';

import type { ImageObject } from '@canvas/schema';

import { imageObject } from './__fixtures__/image-objects.js';
import {
  isSameBinding,
  pageOfPart,
  WHOLE_IMAGE,
  writeImageRecord,
  type ImageBinding,
} from './image-binding.js';
import { PLACEHOLDER_PAGE } from './texture-pages.js';

const IDENTITY = { x: 10, y: 20, cos: 1, sin: 0 };
const LEVEL = { region: { page: 3, u0: 0.25, v0: 0, u1: 0.5, v1: 0.5 }, covers: WHOLE_IMAGE };

function record(object: ImageObject, binding: ImageBinding, index = 0): number[] {
  const floats = new Float32Array(22);
  writeImageRecord(floats, { object, transform: IDENTITY }, binding, index);
  return [...floats];
}

describe('writeImageRecord', () => {
  it('draws the whole box from the level region', () => {
    const object = imageObject({
      width: 200,
      height: 100,
      opacity: 0.5,
      naturalSize: { width: 2000, height: 1000 },
    });
    const floats = record(object, {
      color: [1, 0, 0, 1],
      parts: [{ rect: WHOLE_IMAGE, source: LEVEL }],
    });

    expect(floats).toEqual([
      // Float 20 is 1: the image's opacity is the record's trailing transparency.
      10, 20, 1, 0, 0, 0, 200, 100, 0.25, 0, 0.5, 0.5, 0.25, 0, 0.5, 0.5, 1, 0, 0, 1, 1, 1,
    ]);
  });

  it('samples only the cropped part of the level, clamped to the whole level', () => {
    const object = imageObject({
      width: 100,
      height: 100,
      crop: { x: 0.5, y: 0, width: 0.5, height: 1 },
      naturalSize: { width: 2000, height: 1000 },
    });
    const floats = record(object, {
      color: [0, 0, 0, 1],
      parts: [{ rect: WHOLE_IMAGE, source: LEVEL }],
    });

    // Quad: the whole box; UVs: the right half of the level's region.
    expect(floats.slice(4, 16)).toEqual([0, 0, 100, 100, 0.375, 0, 0.5, 0.5, 0.25, 0, 0.5, 0.5]);
  });

  it('places a tile part at its share of the box', () => {
    const object = imageObject({
      width: 400,
      height: 200,
      naturalSize: { width: 4000, height: 2000 },
    });
    const tile = {
      rect: { minU: 0.5, minV: 0.5, maxU: 1, maxV: 1 },
      source: {
        region: { page: 4, u0: 0, v0: 0, u1: 0.125, v1: 0.125 },
        covers: { minU: 0.5, minV: 0.5, maxU: 1, maxV: 1 },
      },
    };
    const floats = record(object, { color: [0, 0, 0, 1], parts: [tile] });

    expect(floats.slice(4, 12)).toEqual([200, 100, 200, 100, 0, 0, 0.125, 0.125]);
  });

  it('never stretches a crop whose box a merge left at another aspect: fitted, centred', () => {
    // The reviewer's probe: the whole 4:3 photo left in the 200 × 300 box of a 2:3 crop, and
    // the left half (2:3) left in the whole photo's 400 × 300 box.
    const squeezed = record(imageObject({ width: 200, height: 300 }), {
      color: [0, 0, 0, 1],
      parts: [{ rect: WHOLE_IMAGE, source: LEVEL }],
    });
    expect(squeezed.slice(4, 8)).toEqual([0, 75, 200, 150]);
    const halved = imageObject({ crop: { x: 0, y: 0, width: 0.5, height: 1 } });
    const drawn = record(halved, {
      color: [0, 0, 0, 1],
      parts: [{ rect: WHOLE_IMAGE, source: LEVEL }],
    });
    expect(drawn.slice(4, 12)).toEqual([100, 0, 200, 300, 0.25, 0, 0.375, 0.5]);
    // Each quad has its crop's aspect: 4000 × 3000 whole, and 2000 × 3000 for the left half.
    expect((squeezed[6] ?? 0) / (squeezed[7] ?? 1)).toBeCloseTo(4 / 3, 6);
    expect((drawn[6] ?? 0) / (drawn[7] ?? 1)).toBeCloseTo(2 / 3, 6);
  });

  it('draws the placeholder colour from the white texel without a source', () => {
    const object = imageObject({ width: 50, height: 50 });
    const floats = record(object, {
      color: [0.2, 0.4, 0.6, 1],
      parts: [{ rect: WHOLE_IMAGE, source: undefined }],
    });

    expect(floats.slice(8, 22).map((value) => Math.round(value * 100) / 100)).toEqual([
      0, 0, 1, 1, 0, 0, 1, 1, 0.2, 0.4, 0.6, 1, 1, 0,
    ]);
  });

  it('leaves a record without a part, or outside the crop, empty', () => {
    const object = imageObject({ crop: { x: 0, y: 0, width: 0.5, height: 0.5 } });
    const outside = { rect: { minU: 0.6, minV: 0.6, maxU: 1, maxV: 1 }, source: LEVEL };

    expect(record(object, { color: [0, 0, 0, 1], parts: [] }).every((value) => value === 0)).toBe(
      true,
    );
    expect(
      record(object, { color: [0, 0, 0, 1], parts: [outside] }).every((value) => value === 0),
    ).toBe(true);
  });
});

describe('isSameBinding and pageOfPart', () => {
  const binding: ImageBinding = {
    color: [0, 0, 0, 1],
    parts: [{ rect: WHOLE_IMAGE, source: LEVEL }],
  };

  it('match equal bindings and tell apart a moved source', () => {
    const copy: ImageBinding = {
      color: [0, 0, 0, 1],
      parts: [{ rect: { ...WHOLE_IMAGE }, source: { ...LEVEL, region: { ...LEVEL.region } } }],
    };
    const moved: ImageBinding = {
      color: [0, 0, 0, 1],
      parts: [{ rect: WHOLE_IMAGE, source: { ...LEVEL, region: { ...LEVEL.region, page: 5 } } }],
    };

    expect(isSameBinding(binding, copy)).toBe(true);
    expect(isSameBinding(binding, moved)).toBe(false);
  });

  it('name the source page, the last part page for a record past the parts, or the placeholder', () => {
    expect(pageOfPart(binding, 0)).toBe(3);
    expect(pageOfPart(binding, 7)).toBe(3);
    expect(
      pageOfPart({ color: [0, 0, 0, 1], parts: [{ rect: WHOLE_IMAGE, source: undefined }] }, 0),
    ).toBe(PLACEHOLDER_PAGE);
  });
});
