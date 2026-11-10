// Independent acceptance for the blocking design-review finding.
import { describe, expect, it } from 'vitest';

import type { ShapeObject } from '@canvas/schema';

import { shapeObject } from '../scene/__fixtures__/scene-objects.js';

import { isPaintedShape } from './shape-object-record.js';

const paint = (alpha: number) => ({
  type: 'linear',
  angle: 0,
  stops: [
    { offset: 0, color: [1, 0, 0, alpha] },
    { offset: 1, color: [0, 0, 1, alpha] },
  ],
});
const shape = (fill: unknown, stroke: unknown) =>
  ({ ...shapeObject('gradient'), fill, stroke }) as unknown as ShapeObject;

describe('painted gradient ordering', () => {
  it('orders translucent gradients against later-pass content below them', () => {
    expect(isPaintedShape(shape(paint(0.5), null))).toBe(true);
  });
  it('keeps visible outlines in ordering when the gradient is fully transparent', () => {
    expect(isPaintedShape(shape(paint(0), { color: [0, 0, 0, 1], width: 2 }))).toBe(true);
  });
  it('omits a fully transparent fill without an outline', () => {
    expect(isPaintedShape(shape(paint(0), null))).toBe(false);
  });
});
