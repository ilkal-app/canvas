// Independent acceptance for colour tokens and modes.
import { describe, expect, it } from 'vitest';

import * as schema from '../index.js';
import { sampleObject, SAMPLE_STYLE } from '../objects/__fixtures__/object-samples.js';

const RED = [1, 0, 0, 1] as const;
const BLUE = [0, 0, 1, 1] as const;
const ref = { token: 'accent' };
const api = schema as unknown as Readonly<Record<string, unknown>>;

function required(name: string): unknown {
  const value = api[name];
  if (value === undefined) throw new Error(`missing export: ${name}`);
  return value;
}

describe('colour shapes', () => {
  it('accepts only a strict TokenRef with a built-in or valid custom id', () => {
    const tokenRefSchema = required('tokenRefSchema') as typeof schema.rgbaSchema;
    const isTokenRef = required('isTokenRef') as (value: unknown) => boolean;
    for (const token of ['ink', 'text', 'muted', 'surface', 'border', 'accent', 'custom-one']) {
      expect(tokenRefSchema.safeParse({ token }).success).toBe(true);
      expect(isTokenRef({ token })).toBe(true);
    }
    for (const invalid of [
      { token: 'bad id' },
      { token: 'accent', extra: true },
      { token: 3 },
      'accent',
    ]) {
      expect(tokenRefSchema.safeParse(invalid).success).toBe(false);
      expect(isTokenRef(invalid)).toBe(false);
    }
  });

  it('accepts refs in fills, backgrounds, sticky colours, strokes and text, but literal ink only in strokes and text', () => {
    const objects = [
      { ...sampleObject('shape', 'shape'), fill: ref },
      { ...sampleObject('path', 'path'), fill: ref },
      { ...sampleObject('frame', 'frame'), background: ref },
      { ...sampleObject('sticky', 'sticky'), color: ref },
      { ...sampleObject('line', 'line'), stroke: { color: ref, width: 2 } },
      {
        ...sampleObject('text', 'text'),
        runs: [{ length: 5, style: { ...SAMPLE_STYLE, color: ref } }],
      },
    ];
    for (const object of objects)
      expect(schema.boardObjectSchema.safeParse(object).success, object.type).toBe(true);
    for (const object of objects.slice(0, 4)) {
      const field =
        object.type === 'frame' ? 'background' : object.type === 'sticky' ? 'color' : 'fill';
      expect(schema.boardObjectSchema.safeParse({ ...object, [field]: 'ink' }).success).toBe(false);
    }
    expect(
      schema.boardObjectSchema.safeParse({
        ...sampleObject('line', 'line'),
        stroke: { color: 'ink', width: 2 },
      }).success,
    ).toBe(true);
  });

  it('accepts token refs in overrides but keeps gradient stops tuple-only', () => {
    const overrideRecordSchema = required('overrideRecordSchema') as typeof schema.rgbaSchema;
    for (const field of ['fill', 'strokeColor', 'color']) {
      expect(overrideRecordSchema.safeParse({ [field]: ref }).success).toBe(true);
      expect(overrideRecordSchema.safeParse({ [field]: 'ink' }).success).toBe(false);
    }
    expect(overrideRecordSchema.safeParse({ textStyle: { color: ref } }).success).toBe(true);
    const shape = sampleObject('shape', 'gradient');
    const gradient = {
      type: 'linear',
      angle: 0,
      stops: [
        { offset: 0, color: ref },
        { offset: 1, color: RED },
      ],
    };
    expect(schema.boardObjectSchema.safeParse({ ...shape, fill: gradient }).success).toBe(false);
  });

  it('permits colorMode only on frames, mains and instances', () => {
    for (const type of ['frame', 'component', 'instance'] as const) {
      for (const colorMode of ['light', 'dark'])
        expect(
          schema.boardObjectSchema.safeParse({ ...sampleObject(type, type), colorMode }).success,
        ).toBe(true);
      expect(
        schema.boardObjectSchema.safeParse({ ...sampleObject(type, type), colorMode: 'auto' })
          .success,
      ).toBe(false);
    }
    expect(
      schema.boardObjectSchema.safeParse({ ...sampleObject('shape', 'shape'), colorMode: 'dark' })
        .success,
    ).toBe(false);
  });
});

describe('colour resolution', () => {
  it('provides six built-ins and pins ink defaults to INK_COLORS', () => {
    expect(required('BUILTIN_TOKENS') as readonly string[]).toEqual([
      'ink',
      'text',
      'muted',
      'surface',
      'border',
      'accent',
    ]);
    const defaults = required('BUILTIN_TOKEN_DEFAULTS') as Record<
      string,
      { light: unknown; dark: unknown }
    >;
    expect(defaults.ink).toEqual(schema.INK_COLORS);
    for (const name of required('BUILTIN_TOKENS') as readonly string[]) {
      expect(schema.rgbaSchema.safeParse(defaults[name]?.light).success).toBe(true);
      expect(schema.rgbaSchema.safeParse(defaults[name]?.dark).success).toBe(true);
    }
  });

  it('resolves tuples unchanged, literal ink as its ref, edited built-ins and custom tokens', () => {
    const resolveColor = required('resolveColor') as (
      value: unknown,
      mode: string,
      table: unknown,
    ) => unknown;
    const table = new Map([
      [
        'ink',
        {
          id: 'ink',
          name: 'Ink',
          light: RED,
          dark: BLUE,
          identity: { builtin: true, createdBy: 'user:ada', createdAt: 1 },
        },
      ],
      [
        'custom-one',
        {
          id: 'custom-one',
          name: 'Custom',
          light: BLUE,
          dark: RED,
          identity: { builtin: false, createdBy: 'user:ada', createdAt: 1 },
        },
      ],
    ]);
    expect(resolveColor(RED, 'light', table)).toEqual(RED);
    expect(resolveColor('ink', 'dark', table)).toEqual(
      resolveColor({ token: 'ink' }, 'dark', table),
    );
    expect(resolveColor({ token: 'ink' }, 'light', table)).toEqual(RED);
    expect(resolveColor({ token: 'custom-one' }, 'light', table)).toEqual(BLUE);
    expect(resolveColor({ token: 'lost-token' }, 'dark', table)).toEqual(BLUE);
  });

  it('reports an unknown token as a board issue while resolving it to ink', () => {
    const shape = { ...sampleObject('shape', 'unknown'), fill: { token: 'deleted-token' } };
    const board = { objects: new Map([[shape.id, shape]]) };
    expect(schema.validateBoard(board as never)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'unknown-color-token', objectId: shape.id }),
      ]),
    );
    const resolveColor = required('resolveColor') as (
      value: unknown,
      mode: string,
      table: unknown,
    ) => unknown;
    expect(resolveColor(shape.fill, 'light', new Map())).toEqual(schema.INK_COLORS.light);
  });

  it('takes the nearest explicit frame, instance or main mode before viewer theme', () => {
    const effectiveColorMode = required('effectiveColorMode') as (
      object: unknown,
      board: unknown,
      viewer: string,
    ) => string;
    const main = { ...sampleObject('component', 'main'), colorMode: 'dark' };
    const child = { ...sampleObject('shape', 'child'), parentId: main.id };
    const frame = { ...sampleObject('frame', 'frame'), colorMode: 'light' };
    const nested = { ...sampleObject('shape', 'nested'), parentId: frame.id };
    const instance = {
      ...sampleObject('instance', 'instance'),
      mainId: main.id,
      colorMode: 'light',
    };
    const board = {
      objects: new Map([main, child, frame, nested, instance].map((object) => [object.id, object])),
    };
    expect(effectiveColorMode(child, board, 'light')).toBe('dark');
    expect(effectiveColorMode(nested, board, 'dark')).toBe('light');
    expect(effectiveColorMode(instance, board, 'dark')).toBe('light');
    expect(effectiveColorMode(sampleObject('shape', 'root'), board, 'dark')).toBe('dark');
  });
});
