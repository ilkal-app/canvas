import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { importBoard, type ObjectId } from '@canvas/schema';

import { createDocumentMeta, DOCUMENT_META_KEY, META_MAP_NAME } from '../meta/document-meta.js';
import { ADA, createFixtureStore, id, RELAY } from '../store/__fixtures__/store-fixtures.js';
import { internalsOf } from '../store/internal.js';
import { OBJECTS_MAP_NAME } from '../store/yjs-document-store.js';

import { createFixtureBoardJson } from './__fixtures__/fixture-board-json.js';
import { fromYjs, toYjs } from './object-codec.js';
import { plainFieldProblem } from './plain-fields.js';

const OBJECTS = importBoard(createFixtureBoardJson()).objects;

describe('shared types in plain fields', () => {
  it.each([
    ['locked', () => new Y.Map()],
    ['z', () => new Y.Text('bad')],
    ['updatedAt', () => new Y.Array()],
  ] as const)('reports a remote %s field and leaves the store usable', (field, makeValue) => {
    const store = createFixtureStore();
    const remote = new Y.Doc();
    Y.applyUpdate(remote, store.encodeState());
    remote.transact(() => {
      remote.getMap(META_MAP_NAME).set(DOCUMENT_META_KEY, createDocumentMeta());
      const shape = remote.getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME).get('shape-box');
      shape?.set(field, makeValue());
    });
    expect(() => {
      store.applyUpdate(Y.encodeStateAsUpdate(remote), RELAY);
    }).not.toThrow();
    expect(() => {
      store.transact(ADA, (tx) => {
        tx.patchObject(id('frame-plan'), { x: 42 });
      });
    }).not.toThrow();
    expect(store.get(id('frame-plan'))?.x).toBe(42);
    expect(store.get(id('shape-box'))).toBeUndefined();
    expect(store.read().issues).toContainEqual(
      expect.objectContaining({
        code: 'malformed-field',
        key: 'shape-box',
        field,
      }),
    );
    expect(Object.isFrozen(internalsOf(store).doc)).toBe(false);
    store.destroy();
    remote.destroy();
  });

  it.each([
    ['shape-box', 'placement', 'x'],
    ['shape-box', 'style', 'fill'],
    ['shape-box', 'identity', 'id'],
    ['shape-box', 'identity', 'type'],
    ['line-divider', 'points.0', null],
  ] as const)(
    'rejects nested shared data in %s %s before freezing any input',
    (id, key, nested) => {
      const object = OBJECTS.get(id as ObjectId);
      if (object === undefined) throw new Error(`missing fixture ${id}`);
      const doc = new Y.Doc();
      const map = toYjs(object);
      doc.getMap('objects').set(id, map);
      const shared = doc.getMap('foreign');
      const payload = { extension: [{ more: shared }] };
      const value = nested === null ? payload : { ...(map.get(key) as object), [nested]: payload };
      map.set(key, value);
      expect(fromYjs(id, map)).toMatchObject({ issue: { code: 'malformed-field' } });
      expect(Object.isFrozen(value)).toBe(false);
      expect(Object.isFrozen(payload)).toBe(false);
      expect(Object.isFrozen(shared)).toBe(false);
      expect(Object.isFrozen(doc)).toBe(false);
      expect(() => shared.set('still', 'writable')).not.toThrow();
      doc.destroy();
    },
  );
});

describe('decoded shared containers keep only plain payloads', () => {
  it.each(['network', 'empty text', 'empty label', 'legacy pair'] as const)(
    'checks unknown properties in %s payloads',
    (kind) => {
      const objectId = {
        network: 'path-squiggle',
        'empty text': 'text-title',
        'empty label': 'shape-box',
        'legacy pair': 'line-divider',
      }[kind];
      const object = OBJECTS.get(objectId as ObjectId);
      if (object === undefined) throw new Error('missing fixture');
      const doc = new Y.Doc();
      const map = toYjs(object);
      doc.getMap('objects').set(objectId, map);
      const extension = { nested: [doc.getMap('foreign')] };
      if (kind === 'network') {
        const network = map.get('vertices') as Y.Map<unknown>;
        const entry = [...network.entries()][0];
        if (entry === undefined) throw new Error('missing vertex');
        const [order, member] = entry[1] as [number, object];
        network.set(entry[0], [order, { ...member, extension }]);
      } else if (kind === 'legacy pair') {
        map.delete('points.0');
        map.delete('points.1');
        map.set('points', [
          { x: 0, y: 0, extension },
          { x: 1, y: 1 },
        ]);
      } else {
        const host = kind === 'empty label' ? (map.get('label') as Y.Map<unknown>) : map;
        const text = host.get('text') as Y.Text;
        text.delete(0, text.length);
        host.set('emptyTextStyle', { ...(host.get('emptyTextStyle') as object), extension });
      }
      expect(fromYjs(objectId, map)).toMatchObject({ issue: { code: 'malformed-field' } });
      expect(Object.isFrozen(extension)).toBe(false);
      expect(Object.isFrozen(doc)).toBe(false);
      doc.destroy();
    },
  );

  it('finds shared values through cycles and shallow-frozen containers without changing them', () => {
    const doc = new Y.Doc();
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    loop.child = Object.freeze({ shared: doc.getMap('foreign') });
    expect(plainFieldProblem({ fill: loop })).toMatchObject({ field: 'fill', isMissing: false });
    expect(Object.isFrozen(loop)).toBe(false);
    delete loop.child;
    expect(plainFieldProblem({ fill: loop })).toBeNull();
    expect(plainFieldProblem({ locked: doc })).toMatchObject({ field: 'locked' });
    expect(Object.isFrozen(doc)).toBe(false);
    doc.destroy();
  });

  it('ignores non-enumerable values, and inherited ones on the record, just as freezing does', () => {
    const doc = new Y.Doc();
    const container: unknown = {};
    Object.defineProperty(container, 'secret', { value: doc });
    const fields = Object.create({ ignored: doc }) as Record<string, unknown>;
    fields.fill = container;
    expect(plainFieldProblem(fields)).toBeNull();
    expect(Object.isFrozen(doc)).toBe(false);
    doc.destroy();
  });

  it('continues to decode intended shared text, labels and networks in every fixture object', () => {
    for (const object of OBJECTS.values()) {
      const doc = new Y.Doc();
      const map = toYjs(object);
      doc.getMap('objects').set(object.id, map);
      expect(fromYjs(object.id, map)).toEqual({ object });
      expect(() => doc.transact(() => doc.getMap('probe').set('key', true))).not.toThrow();
      doc.destroy();
    }
  });
});

describe('plain container traversal', () => {
  it.each([
    ['empty typed array', new Uint8Array()],
    ['typed array', new Uint16Array([1])],
    ['data view', new DataView(new ArrayBuffer(4))],
    ['array buffer', new ArrayBuffer(4)],
  ])('rejects a %s before freezing any input', (kind, value) => {
    const parent = { extension: [value] };
    expect(plainFieldProblem({ fill: parent })).toMatchObject({ field: 'fill', isMissing: false });
    expect(Object.isFrozen(parent)).toBe(false);
    expect(Object.isFrozen(value)).toBe(false);
  });

  it('keeps sparse array extension keys while ignoring inherited and non-enumerable indices', () => {
    const array: unknown[] = [];
    array[0] = 1;
    array[2] = 'plain';
    Object.defineProperty(array, '4', { value: new Uint8Array([1]), enumerable: false });
    expect(plainFieldProblem({ fill: array })).toBeNull();
    Object.defineProperty(array, 'extension', { value: new Uint8Array([1]), enumerable: true });
    expect(plainFieldProblem({ fill: array })).toMatchObject({ field: 'fill', isMissing: false });
    expect(Object.isFrozen(array)).toBe(false);
  });
});

// Fix round 1: what JavaScript cannot convert to a primitive. lib0 carries an own
// `toString: 1`, a prototype set through `__proto__` and no prototype, and on each `<`, `+`,
// `String()` and a template literal throw.
describe('containers JavaScript cannot convert', () => {
  it.each([
    ['an own toString', { toString: 1 }],
    ['an own valueOf', { valueOf: 1 }],
    ['an own toJSON', { toJSON: 1 }],
    ['an own constructor', { constructor: 1 }],
    ['an own then', { then: 1 }],
    ['an own __proto__', JSON.parse('{"__proto__": 1}') as unknown],
    ['a prototype set through __proto__', JSON.parse('{"__proto__": {"toString": 1}}') as unknown],
    ['no prototype', JSON.parse('{"__proto__": null}') as unknown],
    ['a foreign prototype', Object.create({ inherited: 1 }) as unknown],
    ['a foreign prototype on an array', Object.setPrototypeOf([1], { '3': 1 }) as unknown],
  ] as const)('refuses %s, at any depth', (kind, value) => {
    expect(plainFieldProblem({ fill: value })).toMatchObject({ field: 'fill', isMissing: false });
    expect(plainFieldProblem({ fill: { deep: [{ deeper: value }] } })).toMatchObject({
      field: 'fill',
    });
  });

  it('accepts a plain record, an array and their nesting', () => {
    expect(
      plainFieldProblem({ fill: [1, { a: [true, null, 'x'] }], stroke: { width: 2 } }),
    ).toBeNull();
  });

  it('does not read the properties it checks', () => {
    let reads = 0;
    const value = {};
    Object.defineProperty(value, 'toString', {
      enumerable: false,
      get: () => {
        reads += 1;
        return 1;
      },
    });
    expect(plainFieldProblem({ fill: value })).not.toBeNull();
    expect(reads).toBe(0);
  });
});
