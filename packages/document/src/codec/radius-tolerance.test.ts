// A frame's corner radius in the stored layout: an optional field of the frame's
// `style` group. The writer leaves it out when absent; a stored value the schema refuses (a replay
// that passed no door) reads as sharp, keeping the frame, and a later write that does not set it
// carries it through unchanged.
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import type { BoardObject, FrameObject } from '@canvas/schema';

import { applyCommand } from '../commands/__fixtures__/command-fixtures.js';
import { moveObjectsCommand } from '../commands/move-objects.js';
import { setStyleCommand } from '../commands/set-style.js';
import { fixtureGateBoard, mergeGroup, rawUpdate } from '../meta/__fixtures__/gate-boards.js';
import { exchange, fixtureObject, RELAY } from '../store/__fixtures__/store-fixtures.js';
import { OBJECTS_MAP_NAME, YjsDocumentStore } from '../store/yjs-document-store.js';

import { toYjs } from './object-codec.js';
import { layoutOf } from './object-layout.js';
import { fromYjs } from './object-reader.js';
import {
  carryRefusedOptionalStyle,
  tolerateStoredOptionalStyle,
} from './optional-style-tolerance.js';

const FRAME = 'frame-plan';
/** A radius this build refuses: three corners. */
const REFUSED = [1, 2, 3];

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
 * A writer holding the fixture board with a refused radius replayed onto its frame.
 *
 * @returns The writer.
 */
function writerWithRefusedRadius(): YjsDocumentStore {
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
    mergeGroup(objects, FRAME, 'style', { cornerRadius: REFUSED });
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

describe('a frame radius in the stored layout', () => {
  it('is a field of the frame’s style group', () => {
    const style = layoutOf('frame')?.codecs.find(
      (codec) => codec.kind === 'group' && codec.key === 'style',
    );
    expect(style).toMatchObject({ fields: expect.arrayContaining(['cornerRadius']) as unknown });
  });

  it('is left out when absent, and round-trips one radius and four', () => {
    const frame = fixtureObject('frame-plan', 'frame');
    const absent = roundTrip(frame);
    expect(Object.keys(absent.map.get('style') as object)).not.toContain('cornerRadius');
    expect((absent.read as FrameObject).cornerRadius).toBeUndefined();
    for (const cornerRadius of [12, [1, 2, 3, 4] as const]) {
      expect(roundTrip({ ...frame, cornerRadius }).read).toMatchObject({ cornerRadius });
    }
  });

  it('reads a replayed radius the schema refuses as sharp, and keeps the frame', () => {
    const store = writerWithRefusedRadius();
    expect(store.read().issues).toEqual([]);
    expect((store.get(FRAME as never) as FrameObject).cornerRadius).toBeUndefined();
    expect(storedStyle(store, FRAME).cornerRadius).toEqual(REFUSED);
  });

  it('keeps a refused stored radius through unrelated writes, on both of two clients', () => {
    const ada = writerWithRefusedRadius();
    const bob = new YjsDocumentStore({ clientId: 3 });
    boards.push(bob);
    exchange(ada, bob);
    applyCommand(bob, moveObjectsCommand, { moves: [{ id: FRAME, by: { x: 0, y: 40 } }] });
    applyCommand(ada, setStyleCommand, { changes: [{ id: FRAME, style: { clip: false } }] });
    exchange(ada, bob);
    for (const store of [ada, bob]) expect(storedStyle(store, FRAME).cornerRadius).toEqual(REFUSED);
    expect(ada.read().objects).toEqual(bob.read().objects);
  });

  it('removes a refused stored radius on an explicit removal, and keeps it removed', () => {
    const store = writerWithRefusedRadius();
    applyCommand(store, setStyleCommand, {
      changes: [{ id: FRAME, style: { cornerRadius: undefined } }],
    });
    expect(storedStyle(store, FRAME)).not.toHaveProperty('cornerRadius');
    applyCommand(store, setStyleCommand, { changes: [{ id: FRAME, style: { clip: true } }] });
    expect(storedStyle(store, FRAME)).not.toHaveProperty('cornerRadius');
    expect((store.get(FRAME as never) as FrameObject).cornerRadius).toBeUndefined();
  });

  it('replaces a refused stored radius with an explicit one', () => {
    const store = writerWithRefusedRadius();
    applyCommand(store, setStyleCommand, { changes: [{ id: FRAME, style: { cornerRadius: 8 } }] });
    expect(storedStyle(store, FRAME).cornerRadius).toBe(8);
    expect(store.get(FRAME as never)).toMatchObject({ cornerRadius: 8 });
  });
});

describe('tolerateStoredOptionalStyle: a frame radius', () => {
  it('keeps absent and acceptable values, and a shape’s radius whatever it holds', () => {
    const shape: Record<string, unknown> = { type: 'shape', cornerRadius: -1 };
    tolerateStoredOptionalStyle(shape);
    expect(shape).toEqual({ type: 'shape', cornerRadius: -1 });
    const frame: Record<string, unknown> = { type: 'frame', cornerRadius: [0, 1, 2, 3] };
    tolerateStoredOptionalStyle(frame);
    expect(frame).toEqual({ type: 'frame', cornerRadius: [0, 1, 2, 3] });
  });

  it('removes a frame’s refused radius', () => {
    const frame: Record<string, unknown> = { type: 'frame', cornerRadius: 'round' };
    tolerateStoredOptionalStyle(frame);
    expect(frame).toEqual({ type: 'frame' });
  });
});

describe('carryRefusedOptionalStyle: a frame radius', () => {
  const fields = ['background', 'cornerRadius'];

  it('carries a stored, refused radius into a group that leaves it out', () => {
    const group: Record<string, unknown> = { background: null };
    carryRefusedOptionalStyle(group, fields, { cornerRadius: REFUSED }, new Set());
    expect(group).toEqual({ background: null, cornerRadius: REFUSED });
  });

  it('carries nothing when the write names the field, even with no value', () => {
    const removal: Record<string, unknown> = { background: null };
    carryRefusedOptionalStyle(
      removal,
      fields,
      { cornerRadius: REFUSED },
      new Set(['cornerRadius']),
    );
    expect(removal).toEqual({ background: null });
  });

  it('writes a radius the group sets as given, and carries nothing the reader keeps', () => {
    const set: Record<string, unknown> = { cornerRadius: 4 };
    carryRefusedOptionalStyle(set, fields, { cornerRadius: REFUSED }, new Set(['cornerRadius']));
    expect(set).toEqual({ cornerRadius: 4 });
    for (const stored of [{ cornerRadius: 3 }, {}, undefined, null, [1], 'x']) {
      const group: Record<string, unknown> = { background: null };
      carryRefusedOptionalStyle(group, fields, stored, new Set());
      expect(group).toEqual({ background: null });
    }
  });

  it('carries nothing into a group whose type does not hold the field', () => {
    const group: Record<string, unknown> = { fill: null };
    carryRefusedOptionalStyle(group, ['fill'], { cornerRadius: REFUSED, opacity: 2 }, new Set());
    expect(group).toEqual({ fill: null });
  });
});
