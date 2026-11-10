import { describe, expect, it } from 'vitest';

import { createBoard } from '../board/board.js';
import { BUILTIN_TOKEN_DEFAULTS } from '../fields/color-tokens.js';
import { INK_COLORS, type Rgba } from '../fields/color.js';
import type { Paint } from '../fields/paint.js';
import type { ObjectId } from '../ids/object-id.js';
import {
  component,
  frame,
  instance,
  shape,
  sticky,
} from '../instances/__fixtures__/component-board.js';
import { resolveInstance } from '../instances/resolve-instance.js';
import type { BoardObject } from '../objects/board-object.js';

import { effectiveColorMode } from './effective-color-mode.js';
import {
  backdropFillOf,
  containerFillOf,
  containerTextMode,
  drawnColorModes,
  FRAME_FILL_DARK_LUMINANCE,
  frameFillColorMode,
  frameFillFallback,
  frameFillModeOf,
  type FrameFillModeOptions,
} from './frame-fill-mode.js';

const BLACK: Rgba = [0, 0, 0, 1];
const WHITE: Rgba = [1, 1, 1, 1];
const NAVY: Rgba = [0.05, 0.08, 0.2, 1];
const LIGHT = { viewerTheme: 'light' } as const;
const DARK = { viewerTheme: 'dark' } as const;

/**
 * WCAG luminance, written out again so the threshold is checked against an independent copy.
 *
 * @param color - An sRGB colour.
 * @returns Its relative luminance.
 */
function luminance(color: Rgba): number {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(color[0]) + 0.7152 * lin(color[1]) + 0.0722 * lin(color[2]);
}

/**
 * Reads a stored object of a test board.
 *
 * @param board - The board.
 * @param board.objects - Its objects.
 * @param id - The id.
 * @returns The object.
 * @throws {Error} When the board has none.
 */
function objectOf(
  board: { readonly objects: ReadonlyMap<ObjectId, BoardObject> },
  id: string,
): BoardObject {
  const found = board.objects.get(id as ObjectId);
  if (found === undefined) throw new Error(`no object ${id}`);
  return found;
}

const modeOf = (fills: readonly unknown[], options: FrameFillModeOptions = LIGHT) =>
  frameFillModeOf(fills as readonly (Paint | null)[], options).mode;

describe('FRAME_FILL_DARK_LUMINANCE', () => {
  it('splits where both inks have the same contrast, so ink takes the higher of the two', () => {
    const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const darkInk = luminance(INK_COLORS.light);
    const lightInk = luminance(INK_COLORS.dark);
    expect(FRAME_FILL_DARK_LUMINANCE).toBeCloseTo(0.186, 3);
    expect(contrast(FRAME_FILL_DARK_LUMINANCE, darkInk)).toBeCloseTo(
      contrast(FRAME_FILL_DARK_LUMINANCE, lightInk),
      10,
    );
    // Either side of the split, the chosen mode's ink contrasts more than the other's.
    for (const gray of [0.3, 0.45, 0.5, 0.6, 0.9]) {
      const fill: Rgba = [gray, gray, gray, 1];
      const ink = modeOf([fill]) === 'dark' ? lightInk : darkInk;
      const other = ink === lightInk ? darkInk : lightInk;
      expect(contrast(luminance(fill), ink)).toBeGreaterThanOrEqual(
        contrast(luminance(fill), other),
      );
    }
  });
});

describe('frameFillModeOf', () => {
  it('gives dark on a dark fill, light on a light one, nothing without a fill', () => {
    expect(modeOf([BLACK])).toBe('dark');
    expect(modeOf([NAVY])).toBe('dark');
    expect(modeOf([WHITE], DARK)).toBe('light');
    expect(modeOf([])).toBeUndefined();
    expect(modeOf([null, null])).toBeUndefined();
  });

  it('lets the nearest deciding fill win: light inside dark, and a bare frame passes through', () => {
    expect(modeOf([WHITE, BLACK])).toBe('light');
    expect(modeOf([BLACK, WHITE])).toBe('dark');
    expect(modeOf([null, BLACK])).toBe('dark');
  });

  it('resolves a token fill in the mode of the fills above it, else the viewer theme', () => {
    const surface = { token: 'surface' };
    expect(frameFillModeOf([surface as Paint], LIGHT)).toEqual({
      mode: 'light',
      didReadViewerTheme: true,
      tokens: ['surface'],
    });
    expect(modeOf([surface], DARK)).toBe('dark');
    // Under a black frame the surface is its dark value whatever the viewer's theme.
    expect(frameFillModeOf([surface as Paint, BLACK], LIGHT)).toEqual({
      mode: 'dark',
      didReadViewerTheme: false,
      tokens: ['surface'],
    });
    expect(luminance(BUILTIN_TOKEN_DEFAULTS.surface.dark)).toBeLessThan(FRAME_FILL_DARK_LUMINANCE);
    // An opaque fixed fill nearer hides the token: the mode no longer depends on it.
    expect(frameFillModeOf([WHITE, surface as Paint], LIGHT)).toEqual({
      mode: 'light',
      didReadViewerTheme: false,
      tokens: [],
    });
    // A translucent one does not.
    expect(frameFillModeOf([[1, 1, 1, 0.6], surface as Paint], DARK)).toEqual({
      mode: 'light',
      didReadViewerTheme: true,
      tokens: ['surface'],
    });
  });

  it("reads the board's values, and a token the board lacks as the ink token's", () => {
    const tokens = new Map([
      ['brand', { light: BLACK, dark: BLACK }],
      ['ink', { light: WHITE, dark: WHITE }],
    ]);
    expect(modeOf([{ token: 'brand' }], { viewerTheme: 'light', tokens } as never)).toBe('dark');
    expect(modeOf([{ token: 'gone' }], { viewerTheme: 'dark', tokens } as never)).toBe('light');
    // Without a table: the built-in ink, light in the light mode means dark ink, a dark fill.
    expect(modeOf([{ token: 'gone' }], LIGHT)).toBe('dark');
  });

  it("resolves the ink token in the viewer's ink colours unless the board edited it", () => {
    const inkColors = { light: WHITE, dark: BLACK };
    expect(modeOf([{ token: 'ink' }], LIGHT)).toBe('dark');
    expect(modeOf([{ token: 'ink' }], { viewerTheme: 'light', inkColors })).toBe('light');
    // A token the board lacks draws as ink too.
    expect(modeOf([{ token: 'gone' }], { viewerTheme: 'dark', inkColors })).toBe('dark');
    const tokens = new Map([['ink', { light: BLACK, dark: WHITE }]]);
    expect(modeOf([{ token: 'ink' }], { viewerTheme: 'light', inkColors, tokens })).toBe('dark');
  });

  it('skips a fill under half opaque and composites a deciding one over the fill above it', () => {
    expect(modeOf([[0, 0, 0, 0.4]])).toBeUndefined();
    expect(modeOf([[0, 0, 0, 0.4], WHITE])).toBe('light');
    // An outermost translucent fill is taken as opaque: no frame depends on the viewer's canvas.
    expect(modeOf([[0, 0, 0, 0.6]], DARK)).toBe('dark');
    expect(modeOf([[1, 1, 1, 0.6]], DARK)).toBe('light');
    // Half black over white is a mid grey (luminance 0.21): light. 60% is darker (0.13): dark.
    expect(modeOf([[0, 0, 0, 0.5], WHITE])).toBe('light');
    expect(modeOf([[0, 0, 0, 0.6], WHITE])).toBe('dark');
  });

  it("takes a gradient's span-weighted mean, and skips an image fill", () => {
    const even = {
      type: 'linear',
      angle: 0,
      stops: [
        { offset: 0, color: BLACK },
        { offset: 1, color: WHITE },
      ],
    };
    const mostlyBlack = {
      type: 'radial',
      center: { x: 0.5, y: 0.5 },
      radius: 0.5,
      stops: [
        { offset: 0, color: BLACK },
        { offset: 0.8, color: BLACK },
        { offset: 1, color: WHITE },
      ],
    };
    expect(modeOf([even], DARK)).toBe('light');
    expect(modeOf([mostlyBlack])).toBe('dark');
    const image = {
      type: 'image',
      assetId: 'asset_1',
      naturalSize: { width: 1, height: 1 },
      fit: 'fill',
      crop: { x: 0, y: 0, width: 1, height: 1 },
    };
    expect(modeOf([image])).toBeUndefined();
    expect(modeOf([image, BLACK])).toBe('dark');
  });

  it('skips fills no reader accepts', () => {
    const hostile = [
      [Number.NaN, 0, 0, 1],
      [0, 0, 1],
      'black',
      { type: 'linear', angle: 0, stops: 'none' },
      { type: 'linear', angle: 0, stops: [] },
      { type: 'linear', angle: 0, stops: [{ offset: 0, color: 'ink' }] },
      { type: 'linear', angle: 0, stops: [null] },
      { type: 'conic', stops: [] },
    ];
    for (const fill of hostile) expect(modeOf([fill, WHITE], DARK)).toBe('light');
  });
});

describe('frameFillColorMode', () => {
  it('walks the ancestors: a dark frame, a light one nested in it, and none', () => {
    const board = createBoard([
      frame('night', null, { background: BLACK }),
      shape('onNight', 'night'),
      frame('card', 'night', { background: WHITE }),
      shape('onCard', 'card'),
      frame('bare', 'card'),
      shape('onBare', 'bare'),
      shape('loose', null),
    ]);
    const mode = (id: string) => frameFillColorMode(objectOf(board, id), board, LIGHT);
    expect(mode('onNight')).toBe('dark');
    expect(mode('card')).toBe('dark');
    expect(mode('onCard')).toBe('light');
    expect(mode('onBare')).toBe('light');
    expect(mode('loose')).toBeUndefined();
    expect(mode('night')).toBeUndefined();
  });

  it('walks virtual content through frames of the main, then the instance and its ancestors', () => {
    const board = createBoard([
      component('m'),
      frame('panel', 'm', { background: WHITE }),
      shape('leaf', 'panel'),
      shape('edge', 'm'),
      frame('night', null, { background: BLACK }),
      instance('i', 'm', { parentId: 'night' }),
    ]);
    const content = resolveInstance(board, objectOf(board, 'i') as never).objects;
    const at = (id: string) => {
      const found = content.find((object) => object.id === id);
      if (found === undefined) throw new Error(`no virtual object ${id}`);
      return frameFillColorMode(found, board, DARK);
    };
    expect(at('i/leaf')).toBe('light');
    expect(at('i/edge')).toBe('dark');
  });

  it("reads an instance's overridden frame fill on a board that holds its resolved content", () => {
    const board = createBoard([
      component('m'),
      frame('panel', 'm', { background: WHITE }),
      shape('leaf', 'panel'),
      instance('i', 'm', { overrides: { panel: { fill: BLACK } } }),
    ]);
    const content = resolveInstance(board, objectOf(board, 'i') as never).objects;
    const merged = {
      objects: new Map([
        ...board.objects,
        ...content.map((object) => [object.id, object] as const),
      ]),
    };
    const leaf = content.find((object) => object.id === 'i/leaf');
    if (leaf === undefined) throw new Error('no virtual leaf');
    // As the engine draws it: the virtual panel, black; the stored board knows only the main's.
    expect(frameFillColorMode(leaf, merged, LIGHT)).toBe('dark');
    expect(effectiveColorMode(leaf, merged, { fallbackMode: frameFillFallback(LIGHT) })).toBe(
      'dark',
    );
    expect(frameFillColorMode(leaf, board, LIGHT)).toBe('light');
  });

  it("serves as effectiveColorMode's fallback, which an explicit mode overrides", () => {
    const board = createBoard([
      frame('lit', null, { colorMode: 'light' }),
      frame('night', 'lit', { background: BLACK }),
      shape('held', 'night'),
      frame('free', null, { background: BLACK }),
      shape('dark', 'free'),
      shape('loose', null),
    ]);
    const fallbackMode = frameFillFallback(DARK);
    const mode = (id: string, viewerTheme: 'light' | 'dark') =>
      effectiveColorMode(objectOf(board, id), board, { viewerTheme, fallbackMode });
    expect(mode('held', 'dark')).toBe('light');
    expect(mode('dark', 'light')).toBe('dark');
    expect(mode('loose', 'light')).toBe('light');
  });

  it('ends its walk at a missing parent or a loop', () => {
    const orphan = createBoard([shape('s', 'gone')]);
    expect(frameFillColorMode(objectOf(orphan, 's'), orphan, LIGHT)).toBeUndefined();
    const looped = createBoard([
      frame('a', 'b', { background: BLACK }),
      frame('b', 'a', { background: WHITE }),
      shape('s', 'a'),
    ]);
    expect(frameFillColorMode(objectOf(looped, 's'), looped, LIGHT)).toBeDefined();
  });

  it('reads only a frame’s background as a fill', () => {
    expect(backdropFillOf(frame('f', null, { background: NAVY }))).toEqual(NAVY);
    expect(backdropFillOf(shape('s', null, { fill: BLACK }))).toBeNull();
    expect(backdropFillOf(component('m'))).toBeNull();
  });
});

const PASTEL: Rgba = [1, 0.93, 0.6, 1];
const PALE_BLUE: Rgba = [0.87, 0.93, 1, 1];

describe('containerTextMode', () => {
  it('gives a light mode on a pastel sticky or a pale shape, in either fill mode', () => {
    for (const fillMode of ['light', 'dark'] as const) {
      expect(containerTextMode(sticky('n', null, { color: PASTEL }), fillMode)).toBe('light');
      expect(containerTextMode(shape('s', null, { fill: PALE_BLUE }), fillMode)).toBe('light');
    }
  });

  it('gives a dark mode on a dark fill', () => {
    expect(containerTextMode(sticky('n', null, { color: NAVY }), 'light')).toBe('dark');
    expect(containerTextMode(shape('s', null, { fill: BLACK }), 'light')).toBe('dark');
  });

  it('resolves a token fill in the mode the fill draws in', () => {
    const fill = { token: 'surface' };
    const values = BUILTIN_TOKEN_DEFAULTS.surface;
    const expected = (mode: 'light' | 'dark') =>
      luminance(values[mode]) < FRAME_FILL_DARK_LUMINANCE ? 'dark' : 'light';
    for (const fillMode of ['light', 'dark'] as const) {
      expect(containerTextMode(shape('s', null, { fill }), fillMode)).toBe(expected(fillMode));
    }
  });

  it('decides nothing without a fill, under half alpha, or for a frame or text', () => {
    expect(containerTextMode(shape('s', null, { fill: null }), 'dark')).toBeUndefined();
    expect(containerTextMode(shape('s', null, { fill: [1, 1, 1, 0.2] }), 'dark')).toBeUndefined();
    expect(containerTextMode(frame('f', null, { background: WHITE }), 'dark')).toBeUndefined();
    expect(containerFillOf(frame('f', null, { background: WHITE }))).toBeNull();
    expect(containerFillOf(sticky('n', null, { color: PASTEL }))).toEqual(PASTEL);
  });
});

describe('drawnColorModes', () => {
  const board = createBoard([
    frame('night', null, { background: BLACK }),
    frame('fixed', null, { colorMode: 'dark' }),
    sticky('onNight', 'night', { color: PASTEL }),
    shape('labelInFixed', 'fixed', { fill: PALE_BLUE }),
    shape('bareInFixed', 'fixed', { fill: null }),
    shape('navyLoose', null, { fill: NAVY }),
    shape('loose', null, { fill: null }),
  ]);
  const modes = (id: string, options: FrameFillModeOptions = LIGHT) =>
    drawnColorModes(objectOf(board, id), board, options);

  it('takes the frame-fill fallback for the fill, as the board draws it', () => {
    expect(modes('onNight').fill).toBe('dark');
    expect(modes('loose')).toEqual({ fill: 'light', text: 'light' });
    expect(modes('loose', DARK)).toEqual({ fill: 'dark', text: 'dark' });
  });

  it("gives a container its own fill's mode for its text, whatever the frame around it", () => {
    expect(modes('onNight')).toEqual({ fill: 'dark', text: 'light' });
    expect(modes('labelInFixed')).toEqual({ fill: 'dark', text: 'light' });
    expect(modes('navyLoose')).toEqual({ fill: 'light', text: 'dark' });
  });

  it("keeps the fill's mode for text with no fill behind it", () => {
    expect(modes('bareInFixed')).toEqual({ fill: 'dark', text: 'dark' });
  });
});
