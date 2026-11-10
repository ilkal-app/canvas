import { describe, expect, it } from 'vitest';

import {
  component,
  frame,
  instance,
  shape,
  sticky,
  text,
} from '../instances/__fixtures__/component-board.js';
import { boardObjectSchema } from '../objects/board-object.js';

import {
  BUILTIN_TOKEN_DEFAULTS,
  BUILTIN_TOKENS,
  isBuiltinToken,
  resolveColor,
  resolveInk,
  tokenEntrySchema,
  type TokenEntry,
  type TokenTable,
} from './color-tokens.js';
import { colorSchema, INK_COLORS, inkableColorSchema, type Rgba } from './color.js';
import {
  gradientStopSchema,
  isGradient,
  isPaintOpaque,
  isPaintVisible,
  paintSchema,
  resolvePaint,
} from './paint.js';
import { isSameColor } from './text-style.js';
import { isTokenRef, tokenRefSchema } from './token-ref.js';

const RED: Rgba = [1, 0, 0, 1];
const BLUE: Rgba = [0, 0, 1, 1];
const GREEN: Rgba = [0, 1, 0, 1];

/**
 * A token table entry.
 *
 * @param id - The token id.
 * @param light - Its light value.
 * @param dark - Its dark value.
 * @returns The entry.
 */
function entry(id: string, light: Rgba, dark: Rgba): TokenEntry {
  return {
    id,
    name: id,
    light,
    dark,
    builtin: isBuiltinToken(id),
    createdBy: null,
    createdAt: 0,
  };
}

describe('token references', () => {
  it('are exactly { token } with a valid id', () => {
    expect(tokenRefSchema.safeParse({ token: 'accent' }).success).toBe(true);
    expect(tokenRefSchema.safeParse({ token: 'tok_1-A' }).success).toBe(true);
    expect(tokenRefSchema.safeParse({ token: 'has space' }).success).toBe(false);
    expect(tokenRefSchema.safeParse({ token: '' }).success).toBe(false);
    expect(tokenRefSchema.safeParse({ token: 'ink', type: 'token' }).success).toBe(false);
    expect(isTokenRef({ token: 'ink' })).toBe(true);
    for (const value of [{ token: 'ink', extra: 1 }, { token: 3 }, ['token'], 'ink', null]) {
      expect(isTokenRef(value)).toBe(false);
    }
  });

  it('are allowed where a colour may be a token, and the literal ink only where it was', () => {
    expect(colorSchema.safeParse({ token: 'surface' }).success).toBe(true);
    expect(colorSchema.safeParse('ink').success).toBe(false);
    expect(inkableColorSchema.safeParse({ token: 'text' }).success).toBe(true);
    expect(inkableColorSchema.safeParse('ink').success).toBe(true);
    expect(paintSchema.safeParse({ token: 'ink' }).success).toBe(true);
    expect(paintSchema.safeParse('ink').success).toBe(false);
    expect(gradientStopSchema.safeParse({ offset: 0, color: { token: 'accent' } }).success).toBe(
      false,
    );
  });

  it('parse on every coloured field of the objects', () => {
    const ref = { token: 'accent' };
    const objects = [
      shape('s', null, { fill: ref, stroke: { color: ref, width: 2 } }),
      sticky('n', null, { color: ref }),
      frame('f', null, { background: ref, colorMode: 'dark' }),
      component('m', { colorMode: 'light' }),
      instance('i', 'm', {
        colorMode: 'dark',
        overrides: {
          s: { fill: ref, strokeColor: ref, textStyle: { color: ref } },
          n: { color: ref },
        },
      }),
    ];
    for (const object of objects) expect(boardObjectSchema.safeParse(object).success).toBe(true);
    const styled = text('t', null, {
      runs: [
        {
          length: 2,
          style: { fontFamily: 'Inter', fontSize: 24, color: ref, weight: 400, italic: false },
        },
      ],
    });
    expect(boardObjectSchema.safeParse(styled).success).toBe(true);
  });

  it('refuse the literal ink under fills, stickies and colour overrides', () => {
    const refused = [
      shape('s', null, { fill: 'ink' }),
      sticky('n', null, { color: 'ink' }),
      frame('f', null, { background: 'ink' }),
      instance('i', 'm', { overrides: { s: { fill: 'ink' } } }),
      instance('j', 'm', { overrides: { s: { strokeColor: 'ink' } } }),
      instance('k', 'm', { overrides: { s: { color: 'ink' } } }),
    ];
    for (const object of refused) expect(boardObjectSchema.safeParse(object).success).toBe(false);
  });

  it('allow a colour mode only on frames, mains and instances', () => {
    expect(boardObjectSchema.safeParse(shape('s', null, { colorMode: 'dark' })).success).toBe(
      false,
    );
    expect(boardObjectSchema.safeParse(frame('f', null, { colorMode: 'dim' })).success).toBe(false);
  });
});

describe('built-in tokens', () => {
  it('are the six names, ink equal to INK_COLORS', () => {
    expect(BUILTIN_TOKENS).toEqual(['ink', 'text', 'muted', 'surface', 'border', 'accent']);
    expect(BUILTIN_TOKEN_DEFAULTS.ink).toBe(INK_COLORS);
    for (const id of BUILTIN_TOKENS) {
      const { light, dark } = BUILTIN_TOKEN_DEFAULTS[id];
      expect(light).toHaveLength(4);
      expect(dark).toHaveLength(4);
      expect(light[3]).toBe(1);
    }
  });

  it('match the Vellum and Graphite theme tokens', () => {
    const hex = (color: Rgba) =>
      `#${color
        .slice(0, 3)
        .map((channel) =>
          Math.round(channel * 255)
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')}`;
    expect(hex(BUILTIN_TOKEN_DEFAULTS.muted.light)).toBe('#5d5c57');
    expect(hex(BUILTIN_TOKEN_DEFAULTS.surface.dark)).toBe('#2b2c29');
    expect(hex(BUILTIN_TOKEN_DEFAULTS.accent.light)).toBe('#b7801c');
  });
});

describe('resolveColor', () => {
  const table: TokenTable = new Map([
    ['accent', entry('accent', RED, BLUE)],
    ['brand', entry('brand', GREEN, RED)],
  ]);

  it('keeps a tuple and resolves ink and { token: ink } alike', () => {
    expect(resolveColor(GREEN, 'dark', table)).toBe(GREEN);
    expect(resolveColor('ink', 'light')).toEqual(INK_COLORS.light);
    expect(resolveColor({ token: 'ink' }, 'dark')).toEqual(INK_COLORS.dark);
  });

  it('reads an edited built-in or a custom token from the table, else the default', () => {
    expect(resolveColor({ token: 'accent' }, 'dark', table)).toBe(BLUE);
    expect(resolveColor({ token: 'brand' }, 'light', table)).toBe(GREEN);
    expect(resolveColor({ token: 'muted' }, 'dark', table)).toBe(BUILTIN_TOKEN_DEFAULTS.muted.dark);
  });

  it('draws an unknown token as the board ink in that mode, never throwing', () => {
    expect(resolveColor({ token: 'gone' }, 'light', table)).toEqual(INK_COLORS.light);
    const edited: TokenTable = new Map([['ink', entry('ink', RED, BLUE)]]);
    expect(resolveColor({ token: 'gone' }, 'dark', edited)).toBe(BLUE);
    expect(resolveColor('ink', 'light', edited)).toBe(RED);
  });

  it('resolves a paint, leaving gradients', () => {
    const gradient = {
      type: 'linear' as const,
      angle: 0,
      stops: [
        { offset: 0, color: RED },
        { offset: 1, color: BLUE },
      ],
    };
    expect(resolvePaint({ token: 'brand' }, 'dark', table)).toBe(RED);
    expect(resolvePaint(gradient, 'dark', table)).toBe(gradient);
    expect(isGradient({ token: 'brand' })).toBe(false);
    expect(isPaintVisible({ token: 'brand' })).toBe(true);
    expect(isPaintOpaque({ token: 'brand' })).toBe(false);
  });

  it('resolveInk reads the built-in defaults for a token reference', () => {
    expect(resolveInk({ token: 'surface' }, 'dark')).toBe(BUILTIN_TOKEN_DEFAULTS.surface.dark);
    expect(resolveInk({ token: 'ink' }, 'light')).toBe(INK_COLORS.light);
    expect(resolveInk({ token: 'custom' }, 'light')).toBe(INK_COLORS.light);
  });
});

describe('token table entries and colour equality', () => {
  it('validates an entry and refuses a blank or long name', () => {
    expect(tokenEntrySchema.safeParse(entry('brand', RED, BLUE)).success).toBe(true);
    expect(tokenEntrySchema.safeParse({ ...entry('brand', RED, BLUE), name: ' ' }).success).toBe(
      false,
    );
    const long = 'x'.repeat(41);
    expect(tokenEntrySchema.safeParse({ ...entry('brand', RED, BLUE), name: long }).success).toBe(
      false,
    );
  });

  it('compares token references by id, apart from the literal ink', () => {
    expect(isSameColor({ token: 'a' }, { token: 'a' })).toBe(true);
    expect(isSameColor({ token: 'a' }, { token: 'b' })).toBe(false);
    expect(isSameColor({ token: 'ink' }, 'ink')).toBe(false);
    expect(isSameColor({ token: 'a' }, RED)).toBe(false);
    expect(isSameColor(RED, [1, 0, 0, 1])).toBe(true);
  });
});
