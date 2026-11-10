// Independent acceptance:, gradient fills as approved at 5c73722a.
import { describe, expect, it } from 'vitest';

import * as schema from '../index.js';
import { sampleObject } from '../objects/__fixtures__/object-samples.js';

const red = [1, 0, 0, 1];
const blue = [0, 0, 1, 1];
const stops = [
  { offset: 0, color: red },
  { offset: 1, color: blue },
];
const linear = { type: 'linear', angle: 0, stops };
const radial = { type: 'radial', center: { x: 0.5, y: 0.5 }, radius: 0.5, stops };

// The approved new export is intentionally absent on the pre-implementation base.
const evaluate = (paint: unknown, u: number, v: number): readonly number[] => {
  const api = schema as unknown as {
    paintColorAt: (paint: unknown, u: number, v: number) => readonly number[];
  };
  expect(api.paintColorAt, 'gradient fills require the shared evaluator').toBeTypeOf('function');
  return api.paintColorAt(paint, u, v);
};
const filled = (type: 'shape' | 'path' | 'frame', paint: unknown) => ({
  ...sampleObject(type, 'painted'),
  [type === 'frame' ? 'background' : 'fill']: paint,
});

describe('gradient acceptance', () => {
  for (const type of ['shape', 'path', 'frame'] as const) {
    for (const paint of [linear, radial, red, null]) {
      it(`accepts ${type} with ${JSON.stringify(paint)}`, () => {
        const input = filled(type, paint);
        const before = structuredClone(input);
        expect(schema.boardObjectSchema.safeParse(input).success).toBe(true);
        expect(input).toEqual(before);
      });
    }
  }
  const invalid = [
    { ...linear, stops: [stops[0]] },
    { ...linear, stops: Array.from({ length: 9 }, (unused, i) => ({ offset: i / 8, color: red })) },
    { ...linear, stops: [...stops].reverse() },
    { ...linear, stops: [{ offset: -0.1, color: red }, stops[1]] },
    { ...linear, stops: [stops[0], { offset: 1.1, color: blue }] },
    { ...linear, stops: [stops[0], { offset: 1, color: 'ink' }] },
    { ...linear, angle: NaN },
    { ...linear, angle: Infinity },
    { ...linear, angle: -Math.PI },
    { ...linear, angle: Math.PI + 0.001 },
    { ...radial, radius: 0 },
    { ...radial, radius: 2.01 },
    { ...radial, center: { x: -0.01, y: 0.5 } },
    { ...radial, center: { x: 0.5, y: Infinity } },
    { ...linear, extra: true },
    { ...linear, type: 'conic' },
    'ink',
  ];
  it.each(invalid)('rejects invalid paint without coercion: %j', (paint) => {
    expect(schema.boardObjectSchema.safeParse(filled('shape', paint)).success).toBe(false);
  });
  it('accepts the exact radial/angle and eight-stop boundaries', () => {
    expect(
      schema.boardObjectSchema.safeParse(filled('shape', { ...linear, angle: Math.PI })).success,
    ).toBe(true);
    expect(
      schema.boardObjectSchema.safeParse(
        filled('shape', { ...radial, radius: 2, center: { x: 0, y: 1 } }),
      ).success,
    ).toBe(true);
    const eight = Array.from({ length: 8 }, (unused, i) => ({ offset: i / 7, color: red }));
    expect(
      schema.boardObjectSchema.safeParse(filled('shape', { ...linear, stops: eight })).success,
    ).toBe(true);
  });
  it('evaluates linear, rotated and radial paints in unit coordinates', () => {
    expect(evaluate(linear, 0, 0.25)).toEqual(red);
    expect(evaluate(linear, 1, 0.75)).toEqual(blue);
    expect(evaluate(linear, 0.5, 0.25)).toEqual([0.5, 0, 0.5, 1]);
    const vertical = evaluate({ ...linear, angle: Math.PI / 2 }, 0.5, 0);
    vertical.forEach((c, i) => {
      expect(c).toBeCloseTo(red[i] ?? 0, 12);
    });
    expect(evaluate(radial, 0.5, 0.5)).toEqual(red);
    expect(evaluate(radial, 1, 0.5)).toEqual(blue);
  });
  it('pads outside stops and takes the later colour at a hard edge', () => {
    const paint = {
      ...linear,
      stops: [
        { offset: 0.25, color: red },
        { offset: 0.5, color: red },
        { offset: 0.5, color: blue },
        { offset: 0.75, color: blue },
      ],
    };
    expect(evaluate(paint, 0, 0)).toEqual(red);
    expect(evaluate(paint, 0.5, 0)).toEqual(blue);
    expect(evaluate(paint, 1, 0)).toEqual(blue);
  });
  it('migrates old solid fills without rewriting them and round-trips gradients', () => {
    const old = {
      format: schema.PORTABLE_BOARD_FORMAT,
      schemaVersion: 1,
      objects: [filled('shape', red)],
    };
    // Pages add page membership; every pre-existing field stays exact.
    expect(schema.exportBoard(schema.importBoard(old)).objects).toEqual(
      old.objects.map((object) => ({
        ...object,
        pageId: object.parentId === null ? 'page-1' : null,
      })),
    );
    const current = {
      ...old,
      schemaVersion: schema.SCHEMA_VERSION,
      pages: [{ id: 'page-1', name: 'Page 1', order: 'a0' }],
      objects: [{ ...filled('shape', radial), pageId: 'page-1' }],
    };
    expect(schema.exportBoard(schema.importBoard(current)).objects).toEqual(current.objects);
  });
});
