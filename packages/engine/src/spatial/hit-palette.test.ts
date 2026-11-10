import { describe, expect, it } from 'vitest';

import type { ColorMode, Rgba } from '@canvas/schema';

import type { ColorTokenValues } from '../paint/color-palette.js';
import {
  FakeSceneDocument,
  frameObject,
  shapeObject,
} from '../scene/__fixtures__/scene-objects.js';

import { hitPaletteOf } from './hit-palette.js';
import { hitPoint } from './hit-point.js';
import { SceneSpatialIndex } from './scene-spatial-index.js';
import { isPointOnShape } from './shape-hit.js';

const CLEAR: Rgba = [0, 0, 0, 0];
const RED: Rgba = [1, 0, 0, 1];
/** A custom token transparent in light mode and red in dark mode. */
const GHOST: ColorTokenValues = new Map([['ghost', { light: CLEAR, dark: RED }]]);

describe('hitPaletteOf', () => {
  it('resolves an object in its effective mode, else the viewer theme', () => {
    const document = new FakeSceneDocument();
    const inside = shapeObject('inside', { parentId: 'dark-frame' });
    const outside = shapeObject('outside');
    document.create(frameObject('dark-frame', { colorMode: 'dark' }), inside, outside);
    let theme: ColorMode = 'light';
    const paletteOf = hitPaletteOf(document, { tokens: () => GHOST, theme: () => theme });
    expect(paletteOf(inside).mode).toBe('dark');
    expect(paletteOf(outside).mode).toBe('light');
    theme = 'dark';
    expect(paletteOf(outside).mode).toBe('dark');
    expect(paletteOf(outside).tokenColor('ghost')).toEqual(RED);
  });

  it('follows a new token table', () => {
    const document = new FakeSceneDocument();
    const shape = shapeObject('s');
    document.create(shape);
    let tokens: ColorTokenValues = GHOST;
    const paletteOf = hitPaletteOf(document, { tokens: () => tokens, theme: () => 'light' });
    expect(paletteOf(shape).tokenColor('ghost')).toEqual(CLEAR);
    tokens = new Map([['ghost', { light: RED, dark: RED }]]);
    expect(paletteOf(shape).tokenColor('ghost')).toEqual(RED);
  });
});

describe('picking a token fill', () => {
  it('treats a token fill transparent in its mode as no fill, as drawn', () => {
    const shape = shapeObject('s', { width: 100, height: 60, fill: { token: 'ghost' } });
    const document = new FakeSceneDocument();
    document.create(shape);
    const light = hitPaletteOf(document, { tokens: () => GHOST, theme: () => 'light' });
    const dark = hitPaletteOf(document, { tokens: () => GHOST, theme: () => 'dark' });
    expect(isPointOnShape(shape, { x: 50, y: 30 }, 4, light(shape))).toBe(false);
    expect(isPointOnShape(shape, { x: 50, y: 30 }, 4, dark(shape))).toBe(true);
    // As an equivalent transparent tuple.
    expect(isPointOnShape({ ...shape, fill: CLEAR }, { x: 50, y: 30 }, 4)).toBe(false);
  });

  it('lets hitPoint reach what shows through a transparent token fill', () => {
    const document = new FakeSceneDocument();
    document.create(
      shapeObject('below', { z: 'a0', x: 20, y: 20, width: 40, height: 40 }),
      shapeObject('ghost', { z: 'a1', width: 100, height: 100, fill: { token: 'ghost' } }),
    );
    const index = new SceneSpatialIndex();
    index.apply(document.takeChanges());
    const point = { x: 40, y: 40 };
    const paletteOf = hitPaletteOf(document, { tokens: () => GHOST, theme: () => 'light' });
    expect(hitPoint(index, document, point, { zoom: 1, paletteOf })).toEqual(['below']);
    expect(hitPoint(index, document, point, { zoom: 1 })[0]).toBe('ghost');
  });
});
