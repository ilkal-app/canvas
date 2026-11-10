// Updates are not validated object by object (README, "Validation and trust"),
// so a peer that skips validation can leave an object with a value the schema rejects: a negative
// width, a vertex whose x is text. A command judges only the fields it writes, so every
// command that leaves such a field alone applies and keeps it as it is, on every client; one that
// writes it must write a valid value. None throws `DocumentWriteError`, which is only for a write
// that a command validated first and got wrong.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { ADA, createFixtureStore, id, RELAY } from '../store/__fixtures__/store-fixtures.js';
import type { YjsDocumentStore } from '../store/yjs-document-store.js';
import { OBJECTS_MAP_NAME } from '../store/yjs-document-store.js';

import { testEnvironment } from './__fixtures__/command-fixtures.js';
import { PATH } from './__fixtures__/network-fixtures.js';
import type { AnyCommand } from './command.js';
import { COMMANDS, type CommandName } from './registry.js';
import { runCommand } from './run-command.js';

/**
 * A store holding the fixture board and a real remote update that breaks one object.
 *
 * @param objectId - The object the peer breaks.
 * @param corrupt - Writes the bad value into the object's map, as the peer does.
 * @returns The store and the sender's document.
 */
function receiveInvalid(
  objectId: string,
  corrupt: (map: Y.Map<unknown>) => void,
): { readonly store: YjsDocumentStore; readonly remote: Y.Doc } {
  const store = createFixtureStore();
  const remote = new Y.Doc();
  Y.applyUpdate(remote, store.encodeState());
  remote.transact(() => {
    const map = remote.getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME).get(objectId);
    if (map !== undefined) corrupt(map);
  });
  store.applyUpdate(Y.encodeStateAsUpdate(remote, store.encodeStateVector()), RELAY);
  return { store, remote };
}

/**
 * Gives a shape a negative width.
 *
 * @param map - The shape's map, in the sender's document.
 */
function negativeWidth(map: Y.Map<unknown>): void {
  map.set('size', { ...(map.get('size') as Record<string, unknown>), width: -5 });
}

/**
 * Gives a path's first vertex an x that is text.
 *
 * @param map - The path's map, in the sender's document.
 */
function textVertex(map: Y.Map<unknown>): void {
  const vertices = map.get('vertices') as Y.Map<unknown>;
  const [order, vertex] = vertices.get('v1') as [number, Record<string, unknown>];
  vertices.set('v1', [order, { ...vertex, x: 'left' }]);
}

/** Commands that write the broken shape but not its width, and so apply. */
const APPLIED: readonly (readonly [CommandName, unknown])[] = [
  ['bringToFront', { ids: ['shape-box'] }],
  ['bringForward', { ids: ['shape-box'] }],
  ['setLocked', { ids: ['shape-box'], locked: true }],
  ['moveObjects', { moves: [{ id: 'shape-box', by: { x: 1, y: 1 } }] }],
  ['rotateObjects', { rotations: [{ id: 'shape-box', by: 1 }] }],
  ['setStyle', { changes: [{ id: 'shape-box', style: { fill: [1, 0, 0, 1] } }] }],
  ['group', { ids: ['shape-box'] }],
];

describe('a command on an object a peer left invalid', () => {
  it.each(APPLIED)('%s applies, keeping the width on both clients', (name, input) => {
    const { store, remote } = receiveInvalid('shape-box', negativeWidth);
    const outcome = runCommand(store, ADA, COMMANDS[name] as AnyCommand, input, testEnvironment());
    expect(outcome.status).toBe('applied');
    expect(store.get(id('shape-box'))).toMatchObject({ width: -5 });
    Y.applyUpdate(remote, store.encodeState(Y.encodeStateVector(remote)));
    const peer = remote.getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME).get('shape-box');
    expect(peer?.get('size')).toMatchObject({ width: -5 });
  });

  it.each([
    ['sendToBack', { ids: ['shape-box'] }],
    ['sendBackward', { ids: ['shape-box'] }],
  ] as const)('%s writes nothing when the shape is already at the back', (name, input) => {
    const { store } = receiveInvalid('shape-box', negativeWidth);
    const before = store.encodeState();
    const outcome = runCommand(store, ADA, COMMANDS[name] as AnyCommand, input, testEnvironment());
    expect(outcome.status).toBe('applied');
    expect(store.encodeState()).toEqual(before);
  });

  it('resizeObjects gives the shape a valid width again', () => {
    const { store } = receiveInvalid('shape-box', negativeWidth);
    const resize = { resizes: [{ id: 'shape-box', to: { width: 10, height: 10 } }] };
    const outcome = runCommand(store, ADA, COMMANDS.resizeObjects, resize, testEnvironment());
    expect(outcome.status).toBe('applied');
    expect(store.get(id('shape-box'))).toMatchObject({ width: 10, height: 10 });
  });

  it('refuses a resize that writes another invalid width, and writes nothing', () => {
    const { store } = receiveInvalid('shape-box', negativeWidth);
    const before = store.encodeState();
    const resize = { resizes: [{ id: 'shape-box', by: { width: -1, height: 0 } }] };
    const outcome = runCommand(store, ADA, COMMANDS.resizeObjects, resize, testEnvironment());
    expect(outcome.status === 'rejected' ? outcome.errors : []).toEqual([
      expect.objectContaining({ code: 'invalid-object', objectId: 'shape-box', path: ['width'] }),
    ]);
    expect(store.encodeState()).toEqual(before);
  });

  it('deleteObjects still deletes it', () => {
    const { store } = receiveInvalid('shape-box', negativeWidth);
    const outcome = runCommand(
      store,
      ADA,
      COMMANDS.deleteObjects,
      { ids: ['shape-box'] },
      testEnvironment(),
    );
    expect(outcome.status).toBe('applied');
    expect(store.get(id('shape-box'))).toBeUndefined();
  });

  it('reorders a path whose shown vertex is invalid, and edits its other vertices', () => {
    const { store } = receiveInvalid(PATH, textVertex);
    const reorder = runCommand(
      store,
      ADA,
      COMMANDS.bringToFront,
      { ids: [PATH] },
      testEnvironment(),
    );
    expect(reorder.status).toBe('applied');
    const vertex = { id: 'v2', x: 120, y: 0, mirror: 'both' as const };
    const edit = runCommand(
      store,
      ADA,
      COMMANDS.editNetwork,
      { id: PATH, setVertices: [vertex] },
      testEnvironment(),
    );
    expect(edit.status).toBe('applied');
    const path = store.get(id(PATH));
    expect(path?.type === 'path' ? path.vertices.map(({ x }) => x) : []).toEqual([
      'left',
      120,
      200,
    ]);
  });

  it('heals the invalid vertex when an edit sets it', () => {
    const { store } = receiveInvalid(PATH, textVertex);
    const vertex = { id: 'v1', x: 5, y: 0, mirror: 'none' as const };
    const edit = runCommand(
      store,
      ADA,
      COMMANDS.editNetwork,
      { id: PATH, setVertices: [vertex] },
      testEnvironment(),
    );
    expect(edit.status).toBe('applied');
    const path = store.get(id(PATH));
    expect(path?.type === 'path' ? path.vertices[0] : undefined).toEqual(vertex);
  });
});
