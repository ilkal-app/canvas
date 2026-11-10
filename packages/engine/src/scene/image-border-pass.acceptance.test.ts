// Image borders use a stroke-only SDF record immediately after image paint.
import { describe, expect, it } from 'vitest';

import { INK_COLORS, type BoardObject, type ObjectId, type PrincipalId } from '@canvas/schema';

import { SDF_SHAPE_SHADER } from '../gpu/shaders/sdf-shape.generated.js';
import { IMAGE_PASS } from '../images/image-pass.js';
import * as engine from '../index.js';
import { ColorPalette } from '../paint/color-palette.js';
import { SHAPE_KIND_CODES } from '../shapes/shape-instance-layout.js';

import { createStandardScenePasses } from './standard-passes.js';

const IMAGE: BoardObject = {
  id: 'border-image' as ObjectId,
  type: 'image',
  parentId: null,
  x: 10,
  y: 20,
  rotation: 0,
  z: 'a0',
  locked: false,
  createdBy: 'user:ada' as PrincipalId,
  createdAt: 1,
  updatedAt: 1,
  width: 80,
  height: 60,
  assetId: 'asset-photo',
  naturalSize: { width: 80, height: 60 },
  crop: { x: 0, y: 0, width: 1, height: 1 },
  opacity: 1,
} as BoardObject;
const PASS = Reflect.get(engine, 'IMAGE_BORDER_PASS');
const TURNED = { x: 10, y: 20, cos: 0.6, sin: 0.8 } as const;

function recordOf(object: BoardObject, palette?: ColorPalette): number[] {
  const record = new Float32Array(PASS.layout.floatsPerRecord);
  PASS.prepare(record, { object, transform: TURNED, ...(palette ? { palette } : {}) }, 0);
  return Array.from(record);
}

describe('IMAGE_BORDER_PASS', () => {
  it('draws one SDF record only when the image border paints', () => {
    expect(PASS.pipelineSpec.shader).toBe(SDF_SHAPE_SHADER);
    expect(
      PASS.recordCount({ ...IMAGE, border: { color: 'ink', width: 2 } } as unknown as BoardObject),
    ).toBe(1);
    expect(
      PASS.isOccluder?.({ ...IMAGE, border: { color: 'ink', width: 2 } } as unknown as BoardObject),
    ).toBe(true);
    for (const object of [
      IMAGE,
      { ...IMAGE, border: null },
      { ...IMAGE, border: { color: [0, 0, 0, 0], width: 2 } },
    ]) {
      expect(PASS.recordCount(object as BoardObject)).toBe(0);
      expect(recordOf(object as BoardObject).every((value) => value === 0)).toBe(true);
    }
  });

  it('writes a clear rounded box, resolved ink, width and inside alignment', () => {
    const image = { ...IMAGE, border: { color: 'ink', width: 3 } } as unknown as BoardObject;
    const record = recordOf(image, new ColorPalette('dark'));
    expect(record.slice(0, 4)).toEqual([10, 20, 80, 60]);
    expect(record.slice(4, 10)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(record[10]).toBe(SHAPE_KIND_CODES['rounded-box']);
    expect(record.slice(11, 13)).toEqual(Array.from(new Float32Array([0.6, 0.8])));
    expect(record.slice(13, 17)).toEqual(Array.from(new Float32Array(INK_COLORS.dark)));
    expect(record[17]).toBe(3);
    expect(record[19]).toBe(0);
    const tokenImage = {
      ...IMAGE,
      border: { color: { token: 'brand' }, width: 2 },
    } as unknown as BoardObject;
    const palette = new ColorPalette(
      'dark',
      new Map([['brand', { light: [1, 0, 0, 1], dark: [0, 0, 1, 1] }]]),
    );
    expect(recordOf(tokenImage, palette).slice(13, 17)).toEqual([0, 0, 1, 1]);
  });

  it('puts the border immediately after the image pass', () => {
    const jobs = { submit: () => Promise.reject(new Error('not used')) } as never;
    const names = createStandardScenePasses({ jobs }).map(({ name }) => name);
    const index = names.indexOf(IMAGE_PASS.name);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(names[index + 1]).toBe(PASS.name);
  });
});
