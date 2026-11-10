import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';

import type { ObjectId } from '@canvas/schema';

import { applyCommand } from '../commands/__fixtures__/command-fixtures.js';
import { createObjectCommand } from '../commands/create-object.js';
import { setStyleCommand } from '../commands/set-style.js';
import { createFixtureStore, exchange } from '../store/__fixtures__/store-fixtures.js';
import { internalsOf } from '../store/internal.js';
import { OBJECTS_MAP_NAME, YjsDocumentStore } from '../store/yjs-document-store.js';

// A stroke's `strokePoints` and `strokePressures` are separate keys, so two peers that
// replace one each merge to arrays of different lengths. The reader refuses the merged stroke
// (a decode issue, never a crash) and keeps its raw values through unrelated writes.

const ID = 'stroke-merged' as ObjectId;

/**
 * The stroke's map in a store's Yjs document.
 *
 * @param store - The store.
 * @returns The map.
 * @throws {Error} When the store holds no such stroke.
 */
function rawMap(store: YjsDocumentStore): Y.Map<unknown> {
  const map = internalsOf(store).doc.getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME).get(ID);
  if (map === undefined) throw new Error('no stored stroke');
  return map;
}

describe('concurrent replacements of a stroke’s points and pressures', () => {
  it('merge to a decode issue on both peers, kept raw through an unrelated write', () => {
    const ada = createFixtureStore();
    // Bob's client id is above Ada's, so his write wins a key both write concurrently.
    const bob = new YjsDocumentStore({ clientId: internalsOf(ada).doc.clientID + 1 });
    try {
      applyCommand(ada, createObjectCommand, {
        object: {
          id: ID,
          type: 'freehand',
          parentId: null,
          x: 0,
          y: 0,
          tool: 'marker',
          points: [0, 0, 10, 0, 20, 0],
          pressures: [0.2, 0.5, 0.8],
          stroke: { color: 'ink', width: 4 },
        },
      } as never);
      exchange(ada, bob);
      // Ada replaces both arrays (two points); Bob, concurrently, only the pressures (three, as
      // he sees three points). Each peer's own stroke is consistent. Yjs keeps Ada's points (no
      // rival write) and Bob's pressures (the higher client id wins the concurrent key).
      internalsOf(ada).doc.transact(() => {
        rawMap(ada).set('strokePoints', [0, 0, 20, 0]);
        rawMap(ada).set('strokePressures', [0.2, 0.8]);
      });
      internalsOf(bob).doc.transact(() => {
        rawMap(bob).set('strokePressures', [0.1, 0.2, 0.3]);
      });
      expect(bob.get(ID)).toMatchObject({ pressures: [0.1, 0.2, 0.3] });
      exchange(ada, bob);
      exchange(bob, ada);
      for (const store of [ada, bob]) {
        expect(store.get(ID)).toBeUndefined();
        expect(store.read().issues.some(({ key }) => key === ID)).toBe(true);
      }
      const merged = {
        points: rawMap(ada).get('strokePoints'),
        pressures: rawMap(ada).get('strokePressures'),
      };
      expect(merged).toEqual({ points: [0, 0, 20, 0], pressures: [0.1, 0.2, 0.3] });
      expect(merged).toEqual({
        points: rawMap(bob).get('strokePoints'),
        pressures: rawMap(bob).get('strokePressures'),
      });
      applyCommand(ada, setStyleCommand, {
        changes: [{ id: 'shape-box', style: { fill: [0, 1, 0, 1] } }],
      });
      expect(rawMap(ada).get('strokePoints')).toEqual(merged.points);
      expect(rawMap(ada).get('strokePressures')).toEqual(merged.pressures);
    } finally {
      ada.destroy();
      bob.destroy();
    }
  });
});
