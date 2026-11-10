// A path whose stored network a merge or an undo left malformed is read with
// the bad members hidden, and each hidden member is reported in `read().issues`, naming
// the path and the member. The path itself stays readable.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { validateBoard, type BoardObjectOf } from '@canvas/schema';

import { createFixtureStore, RELAY } from './__fixtures__/store-fixtures.js';
import type { DocumentStore } from './document-store.js';
import { OBJECTS_MAP_NAME, YjsDocumentStore } from './yjs-document-store.js';

/** The fixture board's `path-squiggle`: v1 — s1 — v2 — s2 — v3. */
const PATH = 'path-squiggle';

/**
 * Edits the fixture path's stored network the way a merge can leave it: through a raw Yjs
 * document, applied to the store as a remote update, unvalidated.
 *
 * @param store - The store.
 * @param edit - Changes the path's `vertices` and `segments` maps.
 * @throws {Error} When the store holds no fixture path.
 */
function editStoredNetwork(
  store: DocumentStore,
  edit: (network: { vertices: Y.Map<unknown>; segments: Y.Map<unknown> }) => void,
): void {
  const peer = new Y.Doc();
  peer.clientID = 9_998;
  Y.applyUpdate(peer, store.encodeState());
  const path = peer.getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME).get(PATH);
  if (path === undefined) throw new Error('no path');
  peer.transact(() => {
    edit({
      vertices: path.get('vertices') as Y.Map<unknown>,
      segments: path.get('segments') as Y.Map<unknown>,
    });
  });
  store.applyUpdate(Y.encodeStateAsUpdate(peer, store.encodeStateVector()), RELAY);
}

/**
 * The fixture path as a store reads it.
 *
 * @param store - The store.
 * @returns The path.
 * @throws {Error} When it is not a path.
 */
function pathOf(store: DocumentStore): BoardObjectOf<'path'> {
  const object = store.read().objects.get(PATH as BoardObjectOf<'path'>['id']);
  if (object?.type !== 'path') throw new Error('not a path');
  return object;
}

describe('a path whose stored network is malformed', () => {
  it('is read with the segment hidden, and the segment reported by path and member', () => {
    const store = createFixtureStore();
    editStoredNetwork(store, ({ vertices }) => {
      vertices.delete('v3');
    });
    expect(pathOf(store).segments.map(({ id }) => id)).toEqual(['s1']);
    expect(store.read().issues).toEqual([
      {
        code: 'hidden-segment',
        key: PATH,
        field: 'segments',
        member: 's2',
        message: 'segments: segment "s2" ends at missing vertex "v3"',
      },
    ]);
    // The board the snapshot holds keeps every rule: the member is hidden, not dangling.
    expect(validateBoard(store.read())).toEqual([]);
  });

  it('reports a vertex no segment uses as a stray vertex', () => {
    const store = createFixtureStore();
    editStoredNetwork(store, ({ vertices }) => {
      vertices.set('v9', [9, { id: 'v9', x: 5, y: 5, mirror: 'none' }]);
    });
    expect(pathOf(store).vertices.map(({ id }) => id)).toEqual(['v1', 'v2', 'v3']);
    expect(store.read().issues).toEqual([
      {
        code: 'stray-vertex',
        key: PATH,
        field: 'vertices',
        member: 'v9',
        message: 'vertices: vertex "v9" is on no segment',
      },
    ]);
  });

  it('reports every hidden member, and none once the missing vertex comes back', () => {
    const store = createFixtureStore();
    const v3 = pathOf(store).vertices.find(({ id }) => id === 'v3');
    editStoredNetwork(store, ({ vertices, segments }) => {
      vertices.delete('v3');
      segments.set('s0', [
        5,
        { id: 's0', a: 'v1', b: 'v1', ha: { x: 0, y: 0 }, hb: { x: 0, y: 0 } },
      ]);
    });
    expect(store.read().issues.map(({ code, member }) => `${code}:${String(member)}`)).toEqual([
      'hidden-segment:s0',
      'hidden-segment:s2',
    ]);
    editStoredNetwork(store, ({ vertices, segments }) => {
      vertices.set('v3', [2, v3]);
      segments.delete('s0');
    });
    expect(store.read().issues).toEqual([]);
    expect(pathOf(store).segments.map(({ id }) => id)).toEqual(['s1', 's2']);
  });

  it('reports the same issues on a cold read of the same document', () => {
    const store = createFixtureStore();
    editStoredNetwork(store, ({ vertices }) => {
      vertices.delete('v3');
    });
    const cold = new YjsDocumentStore();
    cold.applyUpdate(store.encodeState(), RELAY);
    expect(cold.read().issues).toEqual(store.read().issues);
  });

  it('keeps an unreadable path out of the board, reported once, not as a hidden member', () => {
    const store = createFixtureStore();
    editStoredNetwork(store, ({ segments }) => {
      segments.set('s2', 'not a member');
    });
    expect(store.read().objects.has(PATH as BoardObjectOf<'path'>['id'])).toBe(false);
    expect(store.read().issues).toMatchObject([
      { code: 'malformed-field', key: PATH, field: 'segments' },
    ]);
    expect(store.read().issues).toHaveLength(1);
  });
});
