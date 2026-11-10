import { describe, expect, it } from 'vitest';

import type { WorldBounds } from '../camera/camera.js';

import { ADMISSION_RING_COUNT, admissionRing, centreDistance } from './admission-rings.js';

const VIEW: WorldBounds = { minX: 0, minY: 0, maxX: 200, maxY: 100 };
const box = (x: number, y: number, size = 2): WorldBounds => ({
  minX: x,
  minY: y,
  maxX: x + size,
  maxY: y + size,
});

describe('centreDistance', () => {
  it('is 0 over the centre and measures the larger gap in half viewports', () => {
    expect(centreDistance(box(99, 49), VIEW)).toBe(0);
    expect(centreDistance(box(150, 50), VIEW)).toBe(0.5);
    expect(centreDistance(box(100, 0, 1), VIEW)).toBe(0.98);
    expect(centreDistance(box(-102, 50), VIEW)).toBe(2);
  });

  it('reads a viewport with no extent as distance 0 along it', () => {
    const line: WorldBounds = { minX: 0, minY: 5, maxX: 100, maxY: 5 };
    expect(centreDistance(box(50, 300), line)).toBe(0);
  });
});

describe('admissionRing', () => {
  it('puts the viewport in rings 0 to 7, nearest first', () => {
    expect(admissionRing(box(99, 49), VIEW, true)).toBe(0);
    expect(admissionRing(box(150, 50), VIEW, true)).toBe(4);
    expect(admissionRing(box(198, 98), VIEW, true)).toBe(7);
  });

  it('puts the padding after every viewport ring, the farthest in the last', () => {
    expect(admissionRing(box(201, 50), VIEW, false)).toBe(8);
    expect(admissionRing(box(250, 50), VIEW, false)).toBe(12);
    expect(admissionRing(box(10_000, 50), VIEW, false)).toBe(ADMISSION_RING_COUNT - 1);
  });
});
