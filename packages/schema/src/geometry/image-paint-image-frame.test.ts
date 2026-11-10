import { describe, expect, it } from 'vitest';

import * as schema from '@canvas/schema';
import { imagePaintLayout, type ImagePaint } from '@canvas/schema';

const imagePaintImageFrame = (
  schema as unknown as {
    imagePaintImageFrame: (
      paint: Pick<ImagePaint, 'fit' | 'crop' | 'naturalSize'>,
      box: { width: number; height: number },
    ) => { x: number; y: number; width: number; height: number };
  }
).imagePaintImageFrame;

const CROP = { x: 0.25, y: 0.2, width: 0.5, height: 0.6 };
const BASE: Pick<ImagePaint, 'fit' | 'crop' | 'naturalSize'> = {
  fit: 'fill',
  crop: CROP,
  naturalSize: { width: 400, height: 300 },
};

describe('imagePaintImageFrame', () => {
  it.each(['fill', 'fit', 'crop', 'tile'] as const)(
    'maps the whole image through the effective %s crop onto the drawn rectangle',
    (fit) => {
      const paint = { ...BASE, fit };
      const box = { width: 200, height: 100 };
      const before = structuredClone({ paint, box });
      const frame = imagePaintImageFrame(paint, box);
      const { drawn, crop } = imagePaintLayout(paint, box);
      expect(frame.x + crop.x * frame.width).toBeCloseTo(drawn.x, 9);
      expect(frame.y + crop.y * frame.height).toBeCloseTo(drawn.y, 9);
      expect(crop.width * frame.width).toBeCloseTo(drawn.width, 9);
      expect(crop.height * frame.height).toBeCloseTo(drawn.height, 9);
      expect({ paint, box }).toEqual(before);
    },
  );

  it('places a fill’s full image beyond the stretched crop', () => {
    const frame = imagePaintImageFrame(BASE, { width: 200, height: 100 });
    expect(frame.x).toBeCloseTo(-100, 9);
    expect(frame.y).toBeCloseTo(-100 / 3, 9);
    expect(frame.width).toBeCloseTo(400, 9);
    expect(frame.height).toBeCloseTo(500 / 3, 9);
  });

  it('uses the centred cover cut for crop fit, including an offset stored crop', () => {
    const frame = imagePaintImageFrame(
      { ...BASE, fit: 'crop', crop: { x: 0.25, y: 0, width: 0.5, height: 1 } },
      { width: 200, height: 50 },
    );
    expect(frame.x).toBeCloseTo(-100, 9);
    expect(frame.y).toBeCloseTo(-125, 9);
    expect(frame.width).toBeCloseTo(400, 9);
    expect(frame.height).toBeCloseTo(300, 9);
  });

  it('anchors the first natural-pixel tile at the box’s top-left', () => {
    const frame = imagePaintImageFrame({ ...BASE, fit: 'tile' }, { width: 900, height: 700 });
    expect(frame.x).toBeCloseTo(-100, 9);
    expect(frame.y).toBeCloseTo(-60, 9);
    expect(frame.width).toBeCloseTo(400, 9);
    expect(frame.height).toBeCloseTo(300, 9);
  });
});
