// Acceptance, written before the code.
import { describe, expect, it } from 'vitest';

import type { Shadow } from '@canvas/schema';

import { drawnShadowsOf, readShadowLayers } from '../index.js';
import { frameObject, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { stickyObject } from '../scene/segments/__fixtures__/note-and-text-passes.js';

import { readShadow } from './shape-shadow.js';

const LOW: Shadow = { x: 0, y: 8, blur: 24, spread: 0, color: [0, 0, 0, 0.34] };
const HIGH: Shadow = { x: 0, y: 1, blur: 2, spread: 0, color: [0, 0, 0, 0.2] };
const CLEAR: Shadow = { ...HIGH, color: [0, 0, 0, 0] };

describe('readShadowLayers', () => {
  it('reads every visible layer in stored order and keeps readShadow on the lowest drawn layer', () => {
    expect(readShadowLayers(LOW)).toEqual([LOW]);
    expect(readShadowLayers([LOW, CLEAR, HIGH])).toEqual([LOW, HIGH]);
    expect(readShadowLayers([CLEAR, HIGH])).toEqual([HIGH]);
    expect(readShadow([CLEAR, HIGH])).toBe(HIGH);
  });

  it('refuses a whole invalid list and draws no absent or transparent value', () => {
    for (const value of [undefined, null, 'shadow', CLEAR, [], [LOW, { ...HIGH, blur: -1 }]]) {
      expect(readShadowLayers(value)).toEqual([]);
    }
    expect(readShadowLayers(Array.from({ length: 9 }, () => LOW))).toEqual([]);
  });
});

describe('drawnShadowsOf', () => {
  it('draws all layers for painted shapes and frames, including outline-only objects', () => {
    const layers = [LOW, HIGH];
    expect(drawnShadowsOf(shapeObject('shape', { shadow: layers }))).toEqual(layers);
    expect(drawnShadowsOf(frameObject('frame', { shadow: layers }))).toEqual(layers);
    expect(
      drawnShadowsOf(
        shapeObject('outline', {
          fill: null,
          stroke: { width: 2, color: [0, 0, 0, 1] },
          shadow: layers,
        }),
      ),
    ).toEqual(layers);
    expect(
      drawnShadowsOf(
        frameObject('outline-frame', {
          background: null,
          stroke: { width: 2, color: [0, 0, 0, 1] },
          shadow: layers,
        }),
      ),
    ).toEqual(layers);
  });

  it('draws none for an unpainted object or another object type', () => {
    const layers = [LOW, HIGH];
    expect(drawnShadowsOf(shapeObject('empty', { fill: null, shadow: layers }))).toEqual([]);
    expect(
      drawnShadowsOf(frameObject('empty-frame', { background: null, shadow: layers })),
    ).toEqual([]);
    expect(drawnShadowsOf(stickyObject('sticky'))).toEqual([]);
  });
});
