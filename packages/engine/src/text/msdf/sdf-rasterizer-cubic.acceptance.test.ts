import { describe, expect, it } from 'vitest';

import type { CubicSegment, GlyphOutline, QuadraticSegment } from '@canvas/text';

import { rasterizeSdfGlyph } from './sdf-rasterizer.js';

const CENTER_EM = 0.5;
const RADIUS_EM = 0.375;
const TIER = 64;

function circlePoint(angle: number): { x: number; y: number } {
  return {
    x: CENTER_EM + RADIUS_EM * Math.cos(angle),
    y: CENTER_EM + RADIUS_EM * Math.sin(angle),
  };
}

function cubicCircle(): GlyphOutline {
  const controlLength = (4 / 3) * Math.tan(Math.PI / 8) * RADIUS_EM;
  const contour: CubicSegment[] = [];
  for (let quarter = 0; quarter < 4; quarter += 1) {
    const startAngle = (quarter * Math.PI) / 2;
    const endAngle = startAngle + Math.PI / 2;
    const start = circlePoint(startAngle);
    const end = circlePoint(endAngle);
    contour.push({
      kind: 'cubic',
      x0: start.x,
      y0: start.y,
      c1x: start.x - controlLength * Math.sin(startAngle),
      c1y: start.y + controlLength * Math.cos(startAngle),
      c2x: end.x + controlLength * Math.sin(endAngle),
      c2y: end.y - controlLength * Math.cos(endAngle),
      x1: end.x,
      y1: end.y,
    });
  }
  return { contours: [contour] };
}

function quadraticCircle(): GlyphOutline {
  const contour: QuadraticSegment[] = [];
  const step = Math.PI / 8;
  for (let index = 0; index < 16; index += 1) {
    const startAngle = index * step;
    const endAngle = startAngle + step;
    const start = circlePoint(startAngle);
    const end = circlePoint(endAngle);
    const midpoint = (startAngle + endAngle) / 2;
    const controlRadius = RADIUS_EM / Math.cos(step / 2);
    contour.push({
      kind: 'quadratic',
      x0: start.x,
      y0: start.y,
      cx: CENTER_EM + controlRadius * Math.cos(midpoint),
      cy: CENTER_EM + controlRadius * Math.sin(midpoint),
      x1: end.x,
      y1: end.y,
    });
  }
  return { contours: [contour] };
}

describe('cubic SDF rasterization', () => {
  it('gives a cubic circle the same bitmap coverage as a quadratic circle', () => {
    const cubic = rasterizeSdfGlyph(cubicCircle(), 1, TIER);
    const quadratic = rasterizeSdfGlyph(quadraticCircle(), 1, TIER);
    expect(cubic.field).toBe('sdf');
    expect(cubic.width).toBe(quadratic.width);
    expect(cubic.height).toBe(quadratic.height);
    expect(cubic.left).toBe(quadratic.left);
    expect(cubic.top).toBe(quadratic.top);
    expect(cubic.advance).toBe(quadratic.advance);
    expect(cubic.pixels).toHaveLength(cubic.width * cubic.height);
    expect(quadratic.pixels).toHaveLength(cubic.pixels.length);

    let largestDifference = 0;
    for (let index = 0; index < cubic.pixels.length; index += 1) {
      const cubicValue = cubic.pixels[index] ?? Number.NaN;
      const quadraticValue = quadratic.pixels[index] ?? Number.NaN;
      if (Math.abs(cubicValue - 128) > 3 || Math.abs(quadraticValue - 128) > 3) {
        expect(cubicValue >= 128).toBe(quadraticValue >= 128);
      }
      largestDifference = Math.max(largestDifference, Math.abs(cubicValue - quadraticValue));
    }
    expect(largestDifference).toBeLessThanOrEqual(3);

    const centerColumn = Math.floor(CENTER_EM * TIER - cubic.left);
    const centerRow = Math.floor(cubic.top - CENTER_EM * TIER);
    expect(cubic.pixels[centerRow * cubic.width + centerColumn]).toBeGreaterThan(128);
    expect(cubic.pixels[0]).toBeLessThan(128);
  });
});
