// Fix round 1, the wider question: `fromYjs` trusts field values, so a known field
// could hold a value of another kind than the schema names (a number field holding an object or
// a string, a string field holding a number or an array), and code that compares, adds,
// formats or calls a method on it would misbehave or throw. Every known field's top-level kind
// (string, number, boolean, null, array, object) is now checked against the schema when an
// object is decoded; a mismatch is a `malformed-field`. Real remote updates.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ADA, id } from '../store/__fixtures__/store-fixtures.js';

import { changeKey, receiveWrite } from './__fixtures__/remote-write.js';
import { KIND, kindOfValue, shallowKindsOf } from './field-kinds.js';

/**
 * A writer that changes one field inside a group of an object's map.
 *
 * @param objectId - The object.
 * @param group - The group key.
 * @param field - The field inside the group.
 * @param value - The value the peer writes.
 * @returns A writer for `receiveWrite`.
 */
function inGroup(objectId: string, group: string, field: string, value: unknown) {
  return changeKey(objectId, group, (stored) => ({
    ...(stored as Record<string, unknown>),
    [field]: value,
  }));
}

describe('the kind of a known field, received in a real update', () => {
  it.each([
    [
      'a number field holding an object',
      'shape-box',
      'x',
      inGroup('shape-box', 'placement', 'x', {}),
    ],
    [
      'a number field holding a string',
      'shape-box',
      'x',
      inGroup('shape-box', 'placement', 'x', '5'),
    ],
    [
      'a size field holding null',
      'shape-box',
      'width',
      inGroup('shape-box', 'size', 'width', null),
    ],
    ['z holding an array', 'shape-box', 'z', changeKey('shape-box', 'z', () => [])],
    ['z holding a number', 'shape-box', 'z', changeKey('shape-box', 'z', () => 5)],
    [
      'a boolean holding a string',
      'shape-box',
      'locked',
      changeKey('shape-box', 'locked', () => 'yes'),
    ],
    [
      'a string field holding a number',
      'shape-box',
      'createdBy',
      inGroup('shape-box', 'identity', 'createdBy', 7),
    ],
    [
      'a nullable string holding a number',
      'shape-box',
      'parentId',
      inGroup('shape-box', 'placement', 'parentId', 5),
    ],
    [
      'a nullable string holding an array',
      'shape-box',
      'parentId',
      inGroup('shape-box', 'placement', 'parentId', []),
    ],
    [
      'an object holding a number',
      'path-squiggle',
      'stroke',
      inGroup('path-squiggle', 'style', 'stroke', 5),
    ],
    ['an enum holding a number', 'text-title', 'align', inGroup('text-title', 'style', 'align', 5)],
    [
      'a connector end holding null',
      'connector-flow',
      'from',
      changeKey('connector-flow', 'from', () => null),
    ],
    [
      'a comment anchor holding a string',
      'comment-free',
      'anchor',
      changeKey('comment-free', 'anchor', () => 'here'),
    ],
  ] as const)(
    '%s is a decode issue, and the next read and transaction work',
    (name, objectId, field, write) => {
      const { store } = receiveWrite(write);
      expect(store.get(id(objectId))).toBeUndefined();
      expect(store.read().issues).toContainEqual(
        expect.objectContaining({ code: 'malformed-field', key: objectId, field }),
      );
      expect(() => store.references.topChildOf(null)).not.toThrow();
      expect(() => {
        store.transact(ADA, (transaction) => {
          transaction.patchObject(id('frame-plan'), { x: 42 });
        });
      }).not.toThrow();
      expect(store.get(id('frame-plan'))?.x).toBe(42);
    },
  );

  // A paint field is the exception: a refused paint reads as no fill, and
  // the object, its outline and its label still read (`paint-tolerance.ts`).
  it.each(['red', 'ink', 5, true])(
    'reads a fill holding %j as no fill, keeping the object',
    (fill) => {
      const { store } = receiveWrite(inGroup('shape-box', 'style', 'fill', fill));
      const read = store.get(id('shape-box'));
      expect(read).toMatchObject({ type: 'shape', fill: null });
      expect(read?.type === 'shape' && read.stroke).toBeTruthy();
      expect(store.read().issues).toEqual([]);
    },
  );

  it('leaves a board of well-typed fields alone', () => {
    const { store } = receiveWrite(changeKey('shape-box', 'locked', () => true));
    expect(store.read().issues).toEqual([]);
    expect(store.get(id('shape-box'))?.locked).toBe(true);
  });
});

describe('shallowKindsOf', () => {
  it('reads the top-level kinds a schema accepts', () => {
    expect(shallowKindsOf(z.string())).toBe(KIND.string);
    expect(shallowKindsOf(z.number().min(0))).toBe(KIND.number);
    expect(shallowKindsOf(z.boolean())).toBe(KIND.boolean);
    expect(shallowKindsOf(z.enum(['a', 'b']))).toBe(KIND.string);
    expect(shallowKindsOf(z.literal('a'))).toBe(KIND.string);
    expect(shallowKindsOf(z.literal(true))).toBe(KIND.boolean);
    expect(shallowKindsOf(z.string().nullable())).toBe(KIND.string | KIND.null);
    expect(shallowKindsOf(z.number().optional())).toBe(KIND.number | KIND.undefined);
    expect(shallowKindsOf(z.tuple([z.number(), z.number()]))).toBe(KIND.array);
    expect(shallowKindsOf(z.array(z.string()))).toBe(KIND.array);
    expect(shallowKindsOf(z.strictObject({ a: z.string() }))).toBe(KIND.object);
    expect(shallowKindsOf(z.union([z.string(), z.number()]))).toBe(KIND.string | KIND.number);
    expect(shallowKindsOf(z.string().brand<'Id'>())).toBe(KIND.string);
  });

  it('accepts anything for a schema it does not understand', () => {
    expect(shallowKindsOf(z.unknown())).toBe(
      KIND.string |
        KIND.number |
        KIND.boolean |
        KIND.null |
        KIND.undefined |
        KIND.array |
        KIND.object,
    );
  });
});

describe('kindOfValue', () => {
  it('names the kind of any value', () => {
    expect(kindOfValue('a')).toBe(KIND.string);
    expect(kindOfValue(1)).toBe(KIND.number);
    expect(kindOfValue(true)).toBe(KIND.boolean);
    expect(kindOfValue(null)).toBe(KIND.null);
    expect(kindOfValue(undefined)).toBe(KIND.undefined);
    expect(kindOfValue([])).toBe(KIND.array);
    expect(kindOfValue({})).toBe(KIND.object);
  });
});
