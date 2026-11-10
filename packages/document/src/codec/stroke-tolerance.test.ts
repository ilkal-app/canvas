// A shape's or frame's stroke alignment and a frame's outline in the stored layout:
// optional fields of the object's `style` group, no key of their own, so no layout version
// changes. The writer leaves them out when absent; a stored value the schema refuses (a replay
// that passed no door) reads as absent, keeping the object, and a later write that does not set
// it carries it through unchanged.
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import type { BoardObject } from '@canvas/schema';

import { applyCommand } from '../commands/__fixtures__/command-fixtures.js';
import { moveObjectsCommand } from '../commands/move-objects.js';
import { setStyleCommand } from '../commands/set-style.js';
import { fixtureGateBoard, mergeGroup, rawUpdate } from '../meta/__fixtures__/gate-boards.js';
import { exchange, fixtureObject, RELAY } from '../store/__fixtures__/store-fixtures.js';
import { OBJECTS_MAP_NAME, YjsDocumentStore } from '../store/yjs-document-store.js';

import { toYjs } from './object-codec.js';
import { layoutOf } from './object-layout.js';
import { fromYjs } from './object-reader.js';
import { carryRefusedStrokeStyle, tolerateStoredStrokeStyle } from './stroke-tolerance.js';

const SHAPE = 'shape-box';
const FRAME = 'frame-plan';
/** A frame outline this build refuses: wider than 64. */
const WIDE = { color: 'ink', width: 80 };

const boards: { destroy: () => void }[] = [];

afterEach(() => {
  for (const board of boards.splice(0)) board.destroy();
});

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

/**
 * A writer holding the fixture board with refused stroke values replayed onto a shape and a frame.
 *
 * @returns The writer.
 */
function writerWithRefusedStrokes(): YjsDocumentStore {
  const board = fixtureGateBoard();
  boards.push(
    {
      destroy: () => {
        board.hub.destroy();
      },
    },
    board.writer,
  );
  const update = rawUpdate(board, (objects) => {
    mergeGroup(objects, SHAPE, 'style', { strokeAlign: 'middle' });
    mergeGroup(objects, FRAME, 'style', { stroke: WIDE, strokeAlign: null });
  });
  board.writer.applyUpdate(update, RELAY);
  return board.writer;
}

/**
 * The `style` group an object's stored map holds, read raw from the store's state.
 *
 * @param store - The store.
 * @param id - The object.
 * @returns The stored group.
 */
function storedStyle(store: YjsDocumentStore, id: string): Readonly<Record<string, unknown>> {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, store.encodeState());
  const style = doc.getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME).get(id)?.get('style');
  doc.destroy();
  return style as Readonly<Record<string, unknown>>;
}

describe('stroke alignment and a frame outline in the stored layout', () => {
  it('are fields of the shape’s and the frame’s style group', () => {
    const fieldsOf = (type: 'shape' | 'frame'): unknown =>
      layoutOf(type)?.codecs.find((codec) => codec.kind === 'group' && codec.key === 'style');
    expect(fieldsOf('shape')).toMatchObject({
      fields: expect.arrayContaining(['stroke', 'strokeAlign']) as unknown,
    });
    expect(fieldsOf('frame')).toMatchObject({
      fields: expect.arrayContaining(['stroke', 'strokeAlign']) as unknown,
    });
  });

  it('are left out when absent, and round-trip each value', () => {
    const shape = fixtureObject('shape-box', 'shape');
    const frame = fixtureObject('frame-plan', 'frame');
    for (const object of [shape, frame]) {
      const absent = roundTrip(object);
      const keys = Object.keys(absent.map.get('style') as object);
      expect(keys).not.toContain('strokeAlign');
      expect(absent.read).toMatchObject({ strokeAlign: undefined });
    }
    expect(Object.keys(roundTrip(frame).map.get('style') as object)).not.toContain('stroke');
    for (const strokeAlign of ['inside', 'center', 'outside'] as const) {
      expect(roundTrip({ ...shape, strokeAlign }).read).toMatchObject({ strokeAlign });
      for (const stroke of [null, { color: 'ink' as const, width: 3 }]) {
        expect(roundTrip({ ...frame, stroke, strokeAlign }).read).toMatchObject({
          stroke,
          strokeAlign,
        });
      }
    }
  });

  it('read a replayed value the schema refuses as absent, keep the object, store it as is', () => {
    const store = writerWithRefusedStrokes();
    expect(store.read().issues).toEqual([]);
    expect(store.get(SHAPE as never)).toMatchObject({ type: 'shape', strokeAlign: undefined });
    expect(store.get(FRAME as never)).toMatchObject({
      type: 'frame',
      stroke: undefined,
      strokeAlign: undefined,
    });
    expect(storedStyle(store, SHAPE).strokeAlign).toBe('middle');
    expect(storedStyle(store, FRAME)).toMatchObject({ stroke: WIDE, strokeAlign: null });
  });

  it('keep a refused stored value through unrelated writes, on both of two clients', () => {
    const ada = writerWithRefusedStrokes();
    const bob = new YjsDocumentStore({ clientId: 3 });
    boards.push(bob);
    exchange(ada, bob);
    applyCommand(bob, moveObjectsCommand, { moves: [{ id: SHAPE, by: { x: 0, y: 40 } }] });
    applyCommand(bob, setStyleCommand, { changes: [{ id: SHAPE, style: { cornerRadius: 6 } }] });
    applyCommand(ada, setStyleCommand, { changes: [{ id: FRAME, style: { clip: false } }] });
    exchange(ada, bob);
    for (const store of [ada, bob]) {
      expect(storedStyle(store, SHAPE).strokeAlign).toBe('middle');
      expect(storedStyle(store, FRAME)).toMatchObject({ stroke: WIDE, strokeAlign: null });
    }
    expect(ada.read().objects).toEqual(bob.read().objects);
  });

  it('replace a refused stored value with an explicit one, and a frame’s outline with null', () => {
    const store = writerWithRefusedStrokes();
    applyCommand(store, setStyleCommand, {
      changes: [
        { id: SHAPE, style: { strokeAlign: 'outside' } },
        { id: FRAME, style: { stroke: null, strokeAlign: 'center' } },
      ],
    });
    expect(storedStyle(store, SHAPE).strokeAlign).toBe('outside');
    expect(storedStyle(store, FRAME)).toMatchObject({ stroke: null, strokeAlign: 'center' });
    expect(store.get(FRAME as never)).toMatchObject({ stroke: null, strokeAlign: 'center' });
  });
});

describe('tolerateStoredStrokeStyle', () => {
  it('keeps absent and acceptable values, and a shape’s stroke whatever it holds', () => {
    const shape: Record<string, unknown> = { type: 'shape', stroke: WIDE, strokeAlign: 'center' };
    tolerateStoredStrokeStyle(shape);
    expect(shape).toEqual({ type: 'shape', stroke: WIDE, strokeAlign: 'center' });
    const frame: Record<string, unknown> = { type: 'frame', stroke: null };
    tolerateStoredStrokeStyle(frame);
    expect(frame).toEqual({ type: 'frame', stroke: null });
  });

  it('removes a refused alignment and a refused frame outline', () => {
    const frame: Record<string, unknown> = { type: 'frame', stroke: 'red', strokeAlign: 2 };
    tolerateStoredStrokeStyle(frame);
    expect(frame).toEqual({ type: 'frame' });
  });
});

describe('carryRefusedStrokeStyle', () => {
  it('carries stored, refused values into a group that leaves them out', () => {
    const group: Record<string, unknown> = { background: null };
    carryRefusedStrokeStyle(group, { stroke: WIDE, strokeAlign: 'middle' });
    expect(group).toEqual({ background: null, stroke: WIDE, strokeAlign: 'middle' });
  });

  it('writes values the group sets as given, and carries nothing the reader keeps', () => {
    const set: Record<string, unknown> = { stroke: null, strokeAlign: 'outside' };
    carryRefusedStrokeStyle(set, { stroke: WIDE, strokeAlign: 'middle' });
    expect(set).toEqual({ stroke: null, strokeAlign: 'outside' });
    for (const stored of [{ stroke: null, strokeAlign: 'center' }, {}, undefined, null, [1], 'x']) {
      const group: Record<string, unknown> = { background: null };
      carryRefusedStrokeStyle(group, stored);
      expect(group).toEqual({ background: null });
    }
  });
});
