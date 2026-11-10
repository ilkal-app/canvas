// A shape's or frame's drop shadow in the stored layout: an optional field of the
// object's `style` group, no key of its own, so no layout version changes. The writer leaves it
// out when absent; a stored shadow the schema refuses (a replay that passed no door) reads as
// none, keeping the object, and the stored value is not rewritten.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { DEFAULT_SHADOW, type BoardObject } from '@canvas/schema';

import { fixtureGateBoard, mergeGroup, rawUpdate } from '../meta/__fixtures__/gate-boards.js';
import { RELAY, fixtureObject } from '../store/__fixtures__/store-fixtures.js';
import { OBJECTS_MAP_NAME } from '../store/yjs-document-store.js';

import { toYjs } from './object-codec.js';
import { layoutOf } from './object-layout.js';
import { fromYjs } from './object-reader.js';
import { carryRefusedShadow, tolerateStoredShadow } from './shadow-tolerance.js';

/**
 * Stores an object in a fresh document's object map and reads it back.
 *
 * @param object - The object.
 * @returns The integrated map and the object read from it.
 * @throws {Error} When the map cannot be read.
 */
function roundTrip(object: BoardObject): { map: Y.Map<unknown>; read: BoardObject } {
  const objects = new Y.Doc().getMap<unknown>('objects');
  objects.set(object.id, toYjs(object));
  const map = objects.get(object.id) as Y.Map<unknown>;
  const decoded = fromYjs(object.id, map);
  if ('issue' in decoded) throw new Error(decoded.issue.message);
  return { map, read: decoded.object };
}

describe('a drop shadow in the stored layout', () => {
  it('is a field of the shape’s and the frame’s style group', () => {
    for (const type of ['shape', 'frame'] as const) {
      const style = layoutOf(type)?.codecs.find(
        (codec) => codec.kind === 'group' && codec.key === 'style',
      );
      expect(style).toMatchObject({ fields: expect.arrayContaining(['shadow']) as unknown });
    }
  });

  it('is left out when absent, and round-trips a shadow and null', () => {
    const shape = fixtureObject('shape-box', 'shape');
    const absent = roundTrip(shape);
    expect(Object.keys(absent.map.get('style') as object)).not.toContain('shadow');
    // The reader gives every optional field it does not find as undefined.
    expect(absent.read).toMatchObject({ shadow: undefined });
    for (const shadow of [DEFAULT_SHADOW, null]) {
      expect(roundTrip({ ...shape, shadow }).read).toMatchObject({ shadow });
      const frame = fixtureObject('frame-plan', 'frame');
      expect(roundTrip({ ...frame, shadow }).read).toMatchObject({ shadow });
    }
  });

  it.each(['soft', 4, { ...DEFAULT_SHADOW, color: 'ink' }, { x: 1 }, [1, 2]])(
    'reads a replayed shadow of %j as none, keeping the shape, and stores it as is',
    (shadow) => {
      const board = fixtureGateBoard();
      try {
        const update = rawUpdate(board, (objects) => {
          mergeGroup(objects, 'shape-box', 'style', { shadow });
        });
        board.writer.applyUpdate(update, RELAY);
        const read = board.writer.read();
        const original = fixtureObject('shape-box', 'shape');
        const object = read.objects.get(original.id);
        expect(object).toMatchObject({ type: 'shape', fill: original.fill, shadow: undefined });
        expect(read.issues).toEqual([]);
        const stored = new Y.Doc();
        Y.applyUpdate(stored, board.writer.encodeState());
        const style = stored
          .getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME)
          .get('shape-box')
          ?.get('style');
        expect((style as Record<string, unknown>).shadow).toEqual(shadow);
        stored.destroy();
      } finally {
        board.hub.destroy();
        board.writer.destroy();
      }
    },
  );
});

describe('tolerateStoredShadow', () => {
  it('keeps absent, null and an acceptable shadow, and never adds a field', () => {
    const none: Record<string, unknown> = { fill: null };
    tolerateStoredShadow(none);
    expect(none).toEqual({ fill: null });
    const off: Record<string, unknown> = { shadow: null };
    tolerateStoredShadow(off);
    expect(off).toEqual({ shadow: null });
    const on: Record<string, unknown> = { shadow: DEFAULT_SHADOW };
    tolerateStoredShadow(on);
    expect(on).toEqual({ shadow: DEFAULT_SHADOW });
  });

  it('removes a shadow the schema refuses', () => {
    const target: Record<string, unknown> = { shadow: { ...DEFAULT_SHADOW, blur: -1 } };
    tolerateStoredShadow(target);
    expect(target).toEqual({});
  });
});

describe('carryRefusedShadow', () => {
  const refused = { ...DEFAULT_SHADOW, blur: -1 };

  it('carries a stored, refused shadow into a group that leaves the field out', () => {
    const group: Record<string, unknown> = { fill: null };
    carryRefusedShadow(group, { fill: null, shadow: refused });
    expect(group).toEqual({ fill: null, shadow: refused });
  });

  it('writes a group that sets a shadow, or null, as given', () => {
    for (const shadow of [DEFAULT_SHADOW, null]) {
      const group: Record<string, unknown> = { shadow };
      carryRefusedShadow(group, { shadow: refused });
      expect(group).toEqual({ shadow });
    }
  });

  it('carries nothing that the reader keeps, or from a missing or malformed stored group', () => {
    for (const stored of [
      { shadow: DEFAULT_SHADOW },
      { shadow: null },
      {},
      undefined,
      null,
      [1],
      'x',
    ]) {
      const group: Record<string, unknown> = { fill: null };
      carryRefusedShadow(group, stored);
      expect(group).toEqual({ fill: null });
    }
  });
});
