import { describe, expect, it } from 'vitest';

import { BUILTIN_TOKEN_DEFAULTS, INK_COLORS, type BoardObject, type Rgba } from '@canvas/schema';

import { shapeObject } from '../scene/__fixtures__/scene-objects.js';

import { ColorPalette, LIGHT_PALETTE, paletteOf } from './color-palette.js';
import {
  BASE_COLOR,
  colorTokensOf,
  drawnColor,
  readFill,
  readSolid,
  readGradient,
  readInkable,
  usesInk,
} from './paint-reading.js';

const GRADIENT = {
  type: 'radial',
  center: { x: 0.5, y: 0.5 },
  radius: 0.5,
  stops: [
    { offset: 0, color: [1, 1, 1, 1] },
    { offset: 1, color: [0, 0, 0, 1] },
  ],
};

const DARK: Rgba = [0.9, 0.9, 0.9, 1];
const DARK_PALETTE = new ColorPalette('dark', undefined, { light: INK_COLORS.light, dark: DARK });

describe('readFill', () => {
  it('reads no fill, a tuple and a gradient the schema accepts', () => {
    expect(readFill(null)).toBeNull();
    expect(readFill(undefined)).toBeNull();
    expect(readFill([1, 0, 0, 1])).toEqual([1, 0, 0, 1]);
    expect(readFill(GRADIENT)).toBe(GRADIENT);
    expect(readGradient(GRADIENT)).toBe(GRADIENT);
    expect(readGradient([1, 0, 0, 1])).toBeUndefined();
  });

  it.each([
    ['nine stops', { ...GRADIENT, stops: Array.from({ length: 9 }, () => GRADIENT.stops[0]) }],
    [
      'an offset of 1.5',
      { ...GRADIENT, stops: [{ offset: 1.5, color: [0, 0, 0, 1] }, GRADIENT.stops[1]] },
    ],
    [
      'decreasing offsets',
      { ...GRADIENT, stops: [GRADIENT.stops[1], { offset: 0, color: [0, 0, 0, 1] }] },
    ],
    ['a radius of 0', { ...GRADIENT, radius: 0 }],
    ['an unknown type', { ...GRADIENT, type: 'conic' }],
    ['an unknown key', { ...GRADIENT, spin: 1 }],
    ['ink', 'ink'],
    ['a number', 7],
  ])('reads a fill the schema refuses (%s) as no fill', (name, value) => {
    expect(readFill(value)).toBeNull();
    expect(readGradient(value)).toBeUndefined();
  });
});

describe('readInkable', () => {
  it('reads ink and a tuple as stored, anything else as the base colour', () => {
    expect(readInkable('ink')).toBe('ink');
    expect(readInkable([0, 1, 0, 1])).toEqual([0, 1, 0, 1]);
    for (const value of ['Ink', 'INK', '', null, undefined, {}, [0, 0, 0], ['a', 0, 0, 1]]) {
      expect(readInkable(value)).toBe(BASE_COLOR);
    }
    expect(BASE_COLOR).toEqual([0, 0, 0, 1]);
  });

  it('resolves ink to the palette’s colour and leaves tuples', () => {
    expect(drawnColor('ink', DARK_PALETTE)).toBe(DARK);
    expect(drawnColor([0, 1, 0, 1], DARK_PALETTE)).toEqual([0, 1, 0, 1]);
    expect(drawnColor('nonsense', DARK_PALETTE)).toBe(BASE_COLOR);
    expect(drawnColor('ink')).toBe(INK_COLORS.light);
    expect(paletteOf({ palette: DARK_PALETTE })).toBe(DARK_PALETTE);
    expect(paletteOf({})).toBe(LIGHT_PALETTE);
  });

  it('resolves token strokes, fills and sticky colours in the palette', () => {
    const table = new Map([['brand', { light: [1, 0, 0, 1] as Rgba, dark: [0, 0, 1, 1] as Rgba }]]);
    const dark = new ColorPalette('dark', table);
    expect(drawnColor({ token: 'brand' }, dark)).toEqual([0, 0, 1, 1]);
    expect(readFill({ token: 'brand' }, dark)).toEqual([0, 0, 1, 1]);
    expect(readSolid({ token: 'brand' }, new ColorPalette('light', table))).toEqual([1, 0, 0, 1]);
    expect(readFill({ token: 'surface' }, dark)).toBe(BUILTIN_TOKEN_DEFAULTS.surface.dark);
    // A token the board lacks draws as ink; an unreadable reference as no fill or the base colour.
    expect(readFill({ token: 'gone' }, dark)).toBe(INK_COLORS.dark);
    expect(readFill({ token: 'gone', extra: 1 }, dark)).toBeNull();
    expect(readSolid('nonsense', dark)).toBe(BASE_COLOR);
    // Without a palette a token fill is still a fill.
    expect(readFill({ token: 'gone' })).toBe(INK_COLORS.light);
  });
});

describe('colorTokensOf', () => {
  it('lists the tokens and ink an object draws with, or nothing', () => {
    const shape = shapeObject('s');
    expect(colorTokensOf(shape)).toBeUndefined();
    const named = {
      ...shape,
      fill: { token: 'surface' },
      stroke: { color: 'ink', width: 2 },
      label: { text: 'Hi', runs: [{ length: 2, style: { color: { token: 'brand' } } }] },
    } as unknown as BoardObject;
    expect([...(colorTokensOf(named) ?? [])]).toEqual(['ink', 'surface', 'brand']);
  });
});

describe('usesInk', () => {
  const run = (color: unknown) => ({
    length: 2,
    style: { fontFamily: 'Inter', fontSize: 16, weight: 400, italic: false, color },
  });

  it('finds ink in a stroke, a text run or a label run', () => {
    const shape = shapeObject('s');
    expect(usesInk(shape)).toBe(false);
    expect(usesInk({ ...shape, stroke: { color: 'ink', width: 2 } })).toBe(true);
    expect(usesInk({ ...shape, stroke: { color: [0, 0, 0, 1], width: 2 } })).toBe(false);
    const label = { text: 'Hi', runs: [run([0, 0, 0, 1]), run('ink')] };
    expect(usesInk({ ...shape, label } as unknown as BoardObject)).toBe(true);
    const text = { ...shape, type: 'text', text: 'Hi', runs: [run('ink')] };
    expect(usesInk(text as unknown as BoardObject)).toBe(true);
    expect(usesInk({ ...text, runs: [run([0, 0, 0, 1])] } as unknown as BoardObject)).toBe(false);
  });
});
