import { afterEach, expect, it, vi } from 'vitest';

import { applyTransform, type PathObject } from '@canvas/schema';

import * as bezier from '../paths/bezier.js';

import { pathObject } from './__fixtures__/spatial-objects.js';
import { boundsAround, expandBounds } from './bounds.js';
import { objectGeometry } from './object-geometry.js';
import { worldBoundsOf } from './object-world-bounds.js';

afterEach(() => vi.restoreAllMocks());

it('bounds a curved filled path without flattening curves used only for picking', () => {
  const path = pathObject(
    'p',
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 20, y: 40 },
    ],
    {
      isClosed: true,
      isFilled: true,
      handles: [
        { x: 0, y: 100 },
        { x: 0, y: -100 },
      ],
    },
  );
  const flatten = vi.spyOn(bezier, 'flattenCubic');
  expect(worldBoundsOf(path, { x: 0, y: 0, cos: 1, sin: 0 })).toBeDefined();
  expect(flatten).not.toHaveBeenCalled();
});

it('preserves exact hull bounds for empty, branching, dangling and duplicate-vertex networks', () => {
  const base = pathObject(
    'p',
    [
      { x: -0, y: 0 },
      { x: 100.125, y: -20 },
      { x: 20, y: 80 },
    ],
    {
      isClosed: true,
      isFilled: true,
      handles: [
        { x: 35, y: 71 },
        { x: -11, y: -92 },
      ],
    },
  );
  const cases: PathObject[] = [
    base,
    { ...base, fill: null, stroke: null },
    pathObject('empty', []),
    pathObject('single', [{ x: -0, y: 0 }]),
    {
      ...base,
      segments: [
        ...base.segments,
        { id: 'missing', a: 'v0', b: 'absent', ha: { x: 1000, y: 2000 }, hb: { x: 1, y: 2 } },
      ],
    },
    { ...base, vertices: [...base.vertices, { id: 'v0', x: -200, y: 17, mirror: 'none' }] },
    {
      ...base,
      segments: [
        ...base.segments,
        { id: 'branch', a: 'v0', b: 'v2', ha: { x: 5, y: 9 }, hb: { x: 11, y: 3 } },
      ],
    },
  ];
  for (const path of cases)
    for (const angle of [0, -0, Math.PI / 2, 0.12345, -1.345]) {
      const transform = { x: 1e12 + 0.125, y: -0, cos: Math.cos(angle), sin: Math.sin(angle) };
      const geometry = objectGeometry(path);
      if (geometry?.kind !== 'strokes') throw new Error('Expected path geometry');
      const bounds = boundsAround(
        geometry.hullPoints.map((point) => applyTransform(transform, point)),
      );
      const margin = geometry.strokeWidth * 2;
      const expected = bounds === undefined || margin <= 0 ? bounds : expandBounds(bounds, margin);
      expect(worldBoundsOf(path, transform)).toEqual(expected);
    }
});
