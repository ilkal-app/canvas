import { describe, expect, it } from 'vitest';

import { shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { lineObject } from '../spatial/__fixtures__/spatial-objects.js';

import { squarePath, zigzagPath } from './__fixtures__/path-scene.js';
import { pathLayersOf } from './path-layers.js';

describe('pathLayersOf', () => {
  it('gives a filled closed path a fill then a stroke', () => {
    expect(pathLayersOf(squarePath('p', 0))).toEqual(['fill', 'stroke']);
  });

  it('gives an open path, or a path without fill colour, a stroke only', () => {
    expect(pathLayersOf(zigzagPath('z', 0, { fill: [1, 0, 0, 1] }))).toEqual(['stroke']);
    expect(pathLayersOf(squarePath('p', 0, { fill: null }))).toEqual(['stroke']);
  });

  it('gives a fill only without a stroke, and nothing to an empty path or another type', () => {
    expect(pathLayersOf(squarePath('p', 0, { stroke: null }))).toEqual(['fill']);
    expect(pathLayersOf(squarePath('p', 0, { vertices: [], segments: [] }))).toEqual([]);
    expect(pathLayersOf(shapeObject('s'))).toEqual([]);
  });

  it('gives a line one stroke, its heads included', () => {
    expect(pathLayersOf(lineObject('l'))).toEqual(['stroke']);
    expect(pathLayersOf(lineObject('a', { startCap: 'circle', endCap: 'arrow' }))).toEqual([
      'stroke',
    ]);
  });

  it('answers the same object from memory', () => {
    const path = squarePath('p', 0);
    expect(pathLayersOf(path)).toBe(pathLayersOf(path));
  });
});
