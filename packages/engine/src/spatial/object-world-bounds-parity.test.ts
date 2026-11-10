import { expect, it, vi } from 'vitest';

import { applyTransform } from '@canvas/schema';

import { shapeObject } from '../scene/__fixtures__/scene-objects.js';

import { boundsAround } from './bounds.js';
import { boxCorners, worldBoundsOf } from './object-world-bounds.js';

it('prepares boxed bounds without allocating a mapped transformed-point array', () => {
  const shape = shapeObject('box', { width: 30, height: 20 });
  const mapped = vi.spyOn(Array.prototype, 'map');
  const bounds = worldBoundsOf(shape, { cos: 1, sin: 0, x: 5, y: 7 });
  const count = mapped.mock.calls.length;
  mapped.mockRestore();
  expect(bounds).toEqual({ minX: 5, minY: 7, maxX: 35, maxY: 27 });
  expect(count).toBe(0);
});

it('matches transformed-corner bounds exactly across rotation, extreme values and signed zero', () => {
  const dimensions = [0, -0, 0.1, -0.3, 100, 2 ** 40, Number.MIN_VALUE];
  for (const width of dimensions)
    for (const height of dimensions) {
      const shape = shapeObject('box', { width, height });
      for (const angle of [0, -0, Math.PI / 2, Math.PI, 0.12345, -1.8765]) {
        const transform = { cos: Math.cos(angle), sin: Math.sin(angle), x: 1e12 + 0.125, y: -0 };
        const expected = boundsAround(
          boxCorners({ width, height }).map((point) => applyTransform(transform, point)),
        );
        expect(worldBoundsOf(shape, transform)).toEqual(expected);
      }
    }
});
