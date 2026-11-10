// The four fits of an image paint laid into a box, and the point map
// the engine's shader matches.
import { describe, expect, it } from 'vitest';

import type { ImagePaint } from '../fields/paint.js';

import { imagePaintLayout, imagePaintPointAt } from './image-paint-layout.js';

/** A 400 × 300 image, whole. */
const PAINT: Pick<ImagePaint, 'fit' | 'crop' | 'naturalSize'> = {
  fit: 'fill',
  naturalSize: { width: 400, height: 300 },
  crop: { x: 0, y: 0, width: 1, height: 1 },
};

describe('imagePaintLayout', () => {
  it('fill stretches the crop across the whole box', () => {
    const box = { width: 200, height: 50 };
    expect(imagePaintLayout(PAINT, box)).toEqual({
      drawn: { x: 0, y: 0, width: 200, height: 50 },
      crop: PAINT.crop,
      mode: 'clamp',
    });
  });

  it('fit letterboxes the crop at its own aspect, centred', () => {
    // A 4:3 image in a 200 × 50 box: 66.7 wide, centred.
    const wide = imagePaintLayout({ ...PAINT, fit: 'fit' }, { width: 200, height: 50 });
    expect(wide.mode).toBe('letterbox');
    expect(wide.drawn.height).toBe(50);
    expect(wide.drawn.width).toBeCloseTo(200 / 3, 9);
    expect(wide.drawn.x).toBeCloseTo((200 - 200 / 3) / 2, 9);
    // In a tall box it is the full width, centred vertically.
    const tall = imagePaintLayout({ ...PAINT, fit: 'fit' }, { width: 40, height: 200 });
    expect(tall.drawn).toMatchObject({ x: 0, width: 40 });
    expect(tall.drawn.height).toBeCloseTo(30, 9);
    expect(tall.drawn.y).toBeCloseTo(85, 9);
  });

  it('crop covers the box, cutting a centred band of the crop', () => {
    // A 4:3 image covering a 200 × 50 (4:1) box keeps the full width and a third of the height.
    const wide = imagePaintLayout({ ...PAINT, fit: 'crop' }, { width: 200, height: 50 });
    expect(wide.drawn).toEqual({ x: 0, y: 0, width: 200, height: 50 });
    expect(wide.crop.x).toBe(0);
    expect(wide.crop.width).toBe(1);
    expect(wide.crop.height).toBeCloseTo(1 / 3, 9);
    expect(wide.crop.y).toBeCloseTo(1 / 3, 9);
    // Covering a tall box keeps the full height and a centred band of the width.
    const tall = imagePaintLayout({ ...PAINT, fit: 'crop' }, { width: 30, height: 90 });
    expect(tall.crop.height).toBe(1);
    expect(tall.crop.width).toBeCloseTo(0.25, 9);
    expect(tall.crop.x).toBeCloseTo(0.375, 9);
  });

  it('crop keeps a crop already at the box’s aspect, and its offset when it cuts', () => {
    const matching = imagePaintLayout({ ...PAINT, fit: 'crop' }, { width: 400, height: 300 });
    expect(matching.crop).toEqual(PAINT.crop);
    const offset = imagePaintLayout(
      { ...PAINT, fit: 'crop', crop: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 } },
      { width: 100, height: 25 },
    );
    expect(offset.crop.x).toBe(0.5);
    expect(offset.crop.y).toBeCloseTo(0.5 + (0.5 - 0.5 / 3) / 2, 9);
  });

  it('tile repeats the crop at its natural size from the top-left corner', () => {
    const tiled = imagePaintLayout(
      { ...PAINT, fit: 'tile', crop: { x: 0, y: 0, width: 0.5, height: 1 } },
      { width: 1000, height: 1000 },
    );
    expect(tiled).toEqual({
      drawn: { x: 0, y: 0, width: 200, height: 300 },
      crop: { x: 0, y: 0, width: 0.5, height: 1 },
      mode: 'repeat',
    });
  });

  it('does not mutate its inputs', () => {
    const paint = structuredClone({ ...PAINT, fit: 'crop' as const });
    const box = { width: 200, height: 50 };
    const before = structuredClone({ paint, box });
    imagePaintLayout(paint, box);
    expect({ paint, box }).toEqual(before);
  });
});

describe('imagePaintPointAt', () => {
  it('maps the box corners and centre through a fill', () => {
    const box = { width: 200, height: 50 };
    expect(imagePaintPointAt(PAINT, box, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(imagePaintPointAt(PAINT, box, 1, 1)).toEqual({ x: 1, y: 1 });
    expect(imagePaintPointAt(PAINT, box, 0.5, 0.5)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('is null outside a fit letterbox, and inside it maps the whole crop', () => {
    const box = { width: 200, height: 50 };
    const fit = { ...PAINT, fit: 'fit' as const };
    expect(imagePaintPointAt(fit, box, 0.05, 0.5)).toBeNull();
    expect(imagePaintPointAt(fit, box, 0.95, 0.5)).toBeNull();
    const centre = imagePaintPointAt(fit, box, 0.5, 0.5);
    expect(centre?.x).toBeCloseTo(0.5, 9);
    expect(centre?.y).toBeCloseTo(0.5, 9);
  });

  it('wraps a tile, so the second tile repeats the first', () => {
    const box = { width: 800, height: 300 };
    const tile = { ...PAINT, fit: 'tile' as const };
    const first = imagePaintPointAt(tile, box, 0.1, 0.5);
    const second = imagePaintPointAt(tile, box, 0.6, 0.5);
    expect(second?.x).toBeCloseTo(first?.x ?? Number.NaN, 9);
    expect(second?.y).toBeCloseTo(first?.y ?? Number.NaN, 9);
  });

  it('is null for a degenerate box', () => {
    expect(imagePaintPointAt(PAINT, { width: 0, height: 0 }, 0.5, 0.5)).toBeNull();
  });
});
