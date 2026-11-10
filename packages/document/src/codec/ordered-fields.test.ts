import { expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { importBoard } from '@canvas/schema';

import { createFixtureBoardJson } from './__fixtures__/fixture-board-json.js';
import { fromYjs, toYjs } from './object-codec.js';
import { orderedFields } from './ordered-fields.js';

it('matches own data properties, prototype and key order, including special names', () => {
  const symbol = Symbol('extension');
  const fields = Object.fromEntries<unknown>([
    ['__proto__', { value: true }],
    ['constructor', 3],
    ['2', 2],
    ['a', -0],
    ['missing', undefined],
  ]);
  Object.defineProperty(fields, symbol, { value: 'ignored', enumerable: true });
  const names = ['a', '__proto__', '2', 'constructor', 'missing'];
  const compare = () => {
    const expected = Object.fromEntries(names.map((name) => [name, fields[name]]));
    const actual = orderedFields(names, fields);
    expect(Object.getPrototypeOf(actual)).toBe(Object.prototype);
    expect(Reflect.ownKeys(actual)).toEqual(Reflect.ownKeys(expected));
    expect(Object.getOwnPropertyDescriptors(actual)).toEqual(
      Object.getOwnPropertyDescriptors(expected),
    );
  };
  compare();
  compare();
  names.reverse();
  compare();
  names.pop();
  compare();
  names.push('a');
  compare();
  names[1] = 'new';
  compare();
});

it('reads selected values once in schema order, including duplicate names', () => {
  const reads: string[] = [];
  const fields = Object.defineProperties(
    {},
    {
      a: {
        get: () => {
          reads.push('a');
          return 1;
        },
      },
      b: {
        get: () => {
          reads.push('b');
          return 2;
        },
      },
    },
  );
  const names = ['b', 'a', 'b'];
  expect(orderedFields(names, fields)).toEqual({ b: 2, a: 1 });
  expect(reads).toEqual(['b', 'a', 'b']);
  reads.length = 0;
  expect(orderedFields(names, fields)).toEqual({ b: 2, a: 1 });
  expect(reads).toEqual(['b', 'a', 'b']);
});

it('does not retain removed fields when a mutable schema becomes sparse', () => {
  const names = ['a', 'b'];
  orderedFields(names, { a: 1, b: 2 });
  Reflect.deleteProperty(names, '1');
  expect(() => Object.fromEntries(names.map((name) => [name, 1]))).toThrow(TypeError);
  expect(() => orderedFields(names, { a: 1, b: 2 })).toThrow(TypeError);
});

it('avoids constructing entry pairs after schema metadata is warm, while reads stay fresh and frozen', () => {
  const shape = [...importBoard(createFixtureBoardJson()).objects.values()].find(
    (entry) => entry.type === 'shape',
  );
  if (!shape) throw new Error('Missing fixture shape');
  // Every field set, the optional shadow, stroke alignment and effect
  // style included, so the keys read match its own.
  const object = {
    ...shape,
    shadow: null,
    effectStyleId: 'depth',
    strokeAlign: 'outside' as const,
  };
  const doc = new Y.Doc();
  const objects = doc.getMap('objects');
  objects.set(object.id, toYjs(object));
  const map = objects.get(object.id);
  if (!(map instanceof Y.Map)) throw new Error('Missing object map');
  expect(fromYjs(object.id, map)).toEqual({ object });
  const placement = map.get('placement') as Record<string, unknown>;
  map.set('placement', { ...placement, x: 123.125 });
  const entries = vi.spyOn(Object, 'fromEntries');
  try {
    const decoded = fromYjs(object.id, map);
    expect(entries).not.toHaveBeenCalled();
    if (!('object' in decoded)) throw new Error('Decode failed');
    expect(decoded.object.x).toBe(123.125);
    expect(Object.isFrozen(decoded.object)).toBe(true);
    expect(Object.keys(decoded.object)).toEqual(Object.keys(object));
  } finally {
    entries.mockRestore();
    doc.destroy();
  }
});
