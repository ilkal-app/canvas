import { expect, it } from 'vitest';

import type { BoardObject } from '@canvas/schema';

import { shapeObject } from '../scene/__fixtures__/scene-objects.js';

import { rootPositionClone } from './root-position-clone.js';

it('copies exact fields and nested references into fresh objects at extreme positions', () => {
  const object = shapeObject('a');
  const clone = rootPositionClone(object);
  for (const [x, y] of [
    [-0, Number.MAX_VALUE],
    [Number.MIN_VALUE, -1e30],
  ] as const) {
    const actual = clone(x, y);
    expect(actual).toEqual({ ...object, x, y });
    expect(Reflect.ownKeys(actual)).toEqual(Reflect.ownKeys(object));
    expect(actual).not.toBe(object);
    expect(actual.type === 'shape' && actual.fill).toBe(object.fill);
    expect(Object.is(actual.x, x)).toBe(true);
  }
});

it.each(['extra', 'symbol', 'hidden', 'accessor', 'prototype', 'order'])(
  'preserves spread semantics for noncanonical %s objects',
  (kind) => {
    const object = shapeObject('a');
    if (kind === 'extra') Object.defineProperty(object, 'future', { value: 42, enumerable: true });
    if (kind === 'symbol')
      Object.defineProperty(object, Symbol('future'), { value: 42, enumerable: true });
    if (kind === 'hidden') Object.defineProperty(object, 'x', { value: 42, enumerable: false });
    if (kind === 'accessor')
      Object.defineProperty(object, 'width', { get: () => 42, enumerable: true });
    if (kind === 'prototype') Object.setPrototypeOf(object, { future: 42 });
    const source =
      kind === 'order'
        ? (Object.fromEntries(Object.entries(object).reverse()) as unknown as BoardObject)
        : object;
    const actual = rootPositionClone(source)(-0, 45);
    expect(actual).toEqual({ ...source, x: -0, y: 45 });
    expect(Reflect.ownKeys(actual)).toEqual(Reflect.ownKeys({ ...source, x: -0, y: 45 }));
    expect(Object.getPrototypeOf(actual)).toBe(Object.prototype);
  },
);

it.each([
  ['sticky', ['width', 'height', 'text', 'runs', 'align', 'verticalAlign', 'autoWidth', 'color']],
  ['text', ['width', 'height', 'text', 'runs', 'align', 'verticalAlign', 'autoWidth']],
  ['shape', ['width', 'height', 'kind', 'stroke', 'fill', 'cornerRadius', 'sides', 'label']],
  ['image', ['width', 'height', 'assetId', 'crop', 'naturalSize', 'opacity']],
  ['path', ['vertices', 'segments', 'stroke', 'fill']],
] as const)('preserves every canonical %s field and reference', (type, fields) => {
  const source: Record<string, unknown> = {
    ...shapeObject('a'),
    type,
    text: 'label',
    runs: [],
    align: 'left',
    verticalAlign: 'top',
    autoWidth: false,
    color: [1, 1, 0, 1],
    assetId: 'asset',
    crop: { x: 0, y: 0, width: 1, height: 1 },
    naturalSize: { width: 10, height: 10 },
    opacity: 1,
    vertices: [],
    segments: [],
  };
  const keys = [
    'id',
    'type',
    'parentId',
    'x',
    'y',
    'rotation',
    'z',
    'locked',
    'createdBy',
    'createdAt',
    'updatedAt',
    ...fields,
  ];
  const object = Object.fromEntries(
    keys.map((key) => [key, source[key]]),
  ) as unknown as BoardObject;
  const clone = rootPositionClone(object);
  const first = clone(-0, 1e30);
  const second = clone(3, 4);
  expect(first).toEqual({ ...object, x: -0, y: 1e30 });
  expect(second).toEqual({ ...object, x: 3, y: 4 });
  expect(first).not.toBe(second);
  expect(Object.is(first.x, -0)).toBe(true);
  expect(Reflect.ownKeys(first)).toEqual(keys);
  for (const key of fields) expect(Reflect.get(first, key)).toBe(source[key]);
});

it('does not invoke type accessors while selecting a copier', () => {
  const object = shapeObject('a');
  let reads = 0;
  Object.defineProperty(object, 'type', {
    enumerable: true,
    get: () => {
      reads++;
      return 'shape';
    },
  });
  const clone = rootPositionClone(object);
  expect(reads).toBe(0);
  clone(1, 2);
  expect(reads).toBe(1);
});
