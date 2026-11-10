// PR 1 contract: export imagePaintSchema and isImagePaint from fields/paint.
// An image has no known colour without its asset, so paintColorAt and paintAverageColor return
// null. It is visible, but cannot be assumed opaque because its pixels may have alpha.
import { describe, expect, it } from 'vitest';

import { createBoard } from '../board/board.js';
import { sampleObject } from '../objects/__fixtures__/object-samples.js';
import { boardObjectSchema } from '../objects/board-object.js';
import { exportBoard } from '../portable/export-board.js';
import { importBoard } from '../portable/import-board.js';

import type { Paint } from './paint.js';
import * as paintExports from './paint.js';
import {
  isGradient,
  isPaintOpaque,
  isPaintVisible,
  paintAverageColor,
  paintColorAt,
  paintSchema,
} from './paint.js';

const imagePaintSchema = Reflect.get(
  paintExports,
  'imagePaintSchema',
) as unknown as typeof paintSchema;
const isImagePaint = Reflect.get(paintExports, 'isImagePaint') as (paint: Paint | null) => boolean;

const IMAGE = {
  type: 'image',
  assetId: 'asset-photo',
  naturalSize: { width: 1600, height: 900 },
  fit: 'crop',
  crop: { x: 0.1, y: 0, width: 0.8, height: 1 },
} as const;

function imagePaint(): Paint {
  return imagePaintSchema.parse(IMAGE);
}

describe('image paint schema and helpers', () => {
  it.each(['fill', 'fit', 'crop', 'tile'] as const)('accepts %s with exact image fields', (fit) => {
    expect(imagePaintSchema.parse({ ...IMAGE, fit })).toEqual({ ...IMAGE, fit });
    expect(paintSchema.parse({ ...IMAGE, fit })).toEqual({ ...IMAGE, fit });
  });

  it.each([
    { ...IMAGE, assetId: 'bad id' },
    { ...IMAGE, naturalSize: { width: 0, height: 900 } },
    { ...IMAGE, naturalSize: { width: 1.5, height: 900 } },
    { ...IMAGE, crop: { x: 0.8, y: 0, width: 0.3, height: 1 } },
    { ...IMAGE, fit: 'cover' },
    { ...IMAGE, extra: true },
    { ...IMAGE, crop: { ...IMAGE.crop, extra: true } },
  ])('refuses malformed image paint %#', (paint) => {
    expect(imagePaintSchema.safeParse(paint).success).toBe(false);
    expect(paintSchema.safeParse(paint).success).toBe(false);
  });

  it('distinguishes the third paint form without reading gradient stops', () => {
    const paint = imagePaint();
    expect(isImagePaint(paint)).toBe(true);
    expect(isGradient(paint)).toBe(false);
    expect(isImagePaint([1, 0, 0, 1])).toBe(false);
    expect(paintColorAt(paint, 0.5, 0.5)).toBeNull();
    expect(paintAverageColor(paint)).toBeNull();
    expect(isPaintVisible(paint)).toBe(true);
    expect(isPaintOpaque(paint)).toBe(false);
  });

  it('allows image paint only on a shape fill and frame background', () => {
    const paint = imagePaint();
    expect(
      boardObjectSchema.safeParse(sampleObject('shape', 'shape', { fill: paint })).success,
    ).toBe(true);
    expect(
      boardObjectSchema.safeParse(sampleObject('frame', 'frame', { background: paint })).success,
    ).toBe(true);
    expect(boardObjectSchema.safeParse(sampleObject('path', 'path', { fill: paint })).success).toBe(
      false,
    );
    expect(
      boardObjectSchema.safeParse({ ...sampleObject('sticky', 'sticky'), color: paint }).success,
    ).toBe(false);
    expect(
      boardObjectSchema.safeParse({
        ...sampleObject('instance', 'instance'),
        overrides: { child: { fill: paint } },
      }).success,
    ).toBe(false);
  });

  it('round-trips an image-filled shape and frame through portable JSON', () => {
    const paint = imagePaint();
    const board = createBoard([
      sampleObject('shape', 'shape', { fill: paint }),
      sampleObject('frame', 'frame', { background: { ...IMAGE, fit: 'tile' } as unknown as Paint }),
    ]);
    expect(importBoard(JSON.parse(JSON.stringify(exportBoard(board))) as unknown).objects).toEqual(
      board.objects,
    );
  });
});
