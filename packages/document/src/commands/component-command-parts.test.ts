import { describe, expect, it } from 'vitest';

import { validateBoard } from '@canvas/schema';

import { createHistory } from '../history/undo-manager.js';
import { ADA, id } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, mustGet } from './__fixtures__/command-fixtures.js';
import { placeInstance, seedLeafMain } from './__fixtures__/component-boards.js';
import { deleteObjectsCommand } from './delete-objects.js';
import { detachInstanceCommand } from './detach-instance.js';

/**
 * Seeds a definition large enough that detachment must span transactions.
 *
 * @returns A store containing 1,001 source leaves and one instance.
 */
function largeDefinition(): YjsDocumentStore {
  const store = new YjsDocumentStore();
  seedLeafMain(store, 'main', { x: 0, y: 0 });
  const leaf = mustGet(store, 'main-leaf');
  store.transact(ADA, (transaction) => {
    for (let index = 0; index < 1000; index += 1) {
      transaction.setObject({ ...leaf, id: id(`leaf-${String(index)}`) });
    }
  });
  placeInstance(store, 'main', { instanceId: 'instance', x: 500, y: 0 });
  return store;
}

describe('large component materializations', () => {
  it.each(['detach', 'retire'] as const)(
    'splits %s into bounded valid transactions and one undo',
    (mode) => {
      const store = largeDefinition();
      const before = store.read();
      const history = createHistory(store, ADA.principalId);
      const sizes: number[] = [];
      const stop = store.subscribe(({ created, updated, deleted }) => {
        sizes.push(created.length + updated.length + deleted.length);
        expect(validateBoard(store.read())).toEqual([]);
      });
      if (mode === 'detach') applyCommand(store, detachInstanceCommand, { id: 'instance' });
      else applyCommand(store, deleteObjectsCommand, { ids: ['main'] });
      stop();
      expect(sizes.length).toBeGreaterThan(1);
      expect(sizes.every((size) => size <= 1000)).toBe(true);
      expect(mustGet(store, 'instance').type).toBe('frame');
      expect(store.references.childrenOf(id('instance'))).toHaveLength(1001);
      expect(history.undo()).toBe(true);
      expect(store.read().objects).toEqual(before.objects);
      expect(history.undo()).toBe(false);
      history.destroy();
      store.destroy();
    },
  );
});
