import { describe, expect, it } from 'vitest';

import { validateBoard } from '@canvas/schema';

import { createHistory } from '../history/undo-manager.js';
import { ADA, id } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, mustGet } from './__fixtures__/command-fixtures.js';
import { placeInstance, seedLeafMain } from './__fixtures__/component-boards.js';
import { mustFindCommand } from './__fixtures__/component-fixtures.js';
import { deleteObjectsCommand } from './delete-objects.js';
import { addPageCommand } from './pages/add-page.js';
import { deletePageCommand } from './pages/delete-page.js';
import { runCommand } from './run-command.js';

describe('component integration with existing commands', () => {
  it('moves a retained definition off a deleted page and detaches instances on other pages in one undo', () => {
    const store = new YjsDocumentStore();
    seedLeafMain(store, 'main-card', { x: 100, y: 100 });
    const { pageId } = applyCommand(store, addPageCommand, { name: 'Other' }).result;
    placeInstance(store, 'main-card', { x: 500, y: 100, pageId, instanceId: 'instance-card' });
    const before = store.read();
    const history = createHistory(store, ADA.principalId);
    applyCommand(store, deletePageCommand, { pageId: 'page-1' });
    expect(mustGet(store, 'main-card')).toMatchObject({ retired: true, pageId });
    expect(mustGet(store, 'instance-card')).toMatchObject({ type: 'frame', pageId });
    expect(validateBoard(store.read())).toEqual([]);
    expect(history.undo()).toBe(true);
    expect(store.read().objects).toEqual(before.objects);
    expect(store.readPages()).toEqual(before.pages);
    history.destroy();
    store.destroy();
  });

  it('copies a main with its instance and remaps the main and child override path', () => {
    const store = new YjsDocumentStore();
    seedLeafMain(store, 'main-card', { x: 0, y: 0 });
    placeInstance(store, 'main-card', { x: 300, y: 0, instanceId: 'instance-card' });
    const objects = [...store.read().objects.values()].map((object) =>
      Object.fromEntries(
        Object.entries(object).filter(
          ([key]) => !['z', 'createdBy', 'createdAt', 'updatedAt'].includes(key),
        ),
      ),
    );
    const instance = objects.find((object) => object.id === 'instance-card');
    if (instance === undefined) throw new Error('No seeded instance');
    instance.overrides = { 'main-card-leaf': { text: 'Copy' } };
    const { changes } = applyCommand(store, mustFindCommand('createObjects'), { objects });
    const copied = changes.created.map((objectId) => store.get(objectId));
    const main = copied.find((object) => object?.type === 'component');
    const leaf = copied.find((object) => object?.type === 'sticky');
    const placed = copied.find((object) => object?.type === 'instance');
    expect(main?.id).not.toBe(id('main-card'));
    expect(leaf?.parentId).toBe(main?.id);
    expect(placed).toMatchObject({
      mainId: main?.id,
      overrides: { [leaf?.id ?? 'missing']: { text: 'Copy' } },
    });
    expect(validateBoard(store.read())).toEqual([]);
    store.destroy();
  });
  it('keeps override paths when the referenced main is not copied, even if a source child is copied separately', () => {
    const store = new YjsDocumentStore();
    seedLeafMain(store, 'main', { x: 0, y: 0 });
    placeInstance(store, 'main', { x: 300, y: 0, instanceId: 'instance' });
    const objects = ['main-leaf', 'instance'].map((key) =>
      Object.fromEntries(
        Object.entries({ ...mustGet(store, key), parentId: null, pageId: 'page-1' }).filter(
          ([field]) => !['z', 'createdBy', 'createdAt', 'updatedAt'].includes(field),
        ),
      ),
    );
    const instance = objects[1];
    if (instance === undefined) throw new Error('No instance');
    instance.overrides = { 'main-leaf': { text: 'Copy' } };
    const { changes } = applyCommand(store, mustFindCommand('createObjects'), { objects });
    const copy = changes.created
      .map((key) => store.get(key))
      .find((object) => object?.type === 'instance');
    expect(copy).toMatchObject({ mainId: 'main', overrides: { 'main-leaf': { text: 'Copy' } } });
    store.destroy();
  });
  it('rejects duplicate generated child ids across separate instance materializations atomically', () => {
    const store = new YjsDocumentStore();
    seedLeafMain(store, 'main', { x: 0, y: 0 });
    placeInstance(store, 'main', { instanceId: 'first', x: 300, y: 0 });
    placeInstance(store, 'main', { instanceId: 'second', x: 600, y: 0 });
    const before = store.encodeState();
    const outcome = runCommand(
      store,
      ADA,
      deleteObjectsCommand,
      { ids: ['main'] },
      {
        clock: () => 1_770_000_000_001,
        createId: () => id('shared-child'),
      },
    );
    expect(outcome).toMatchObject({
      status: 'rejected',
      errors: [expect.objectContaining({ code: 'duplicate-id' })],
    });
    expect(store.encodeState()).toEqual(before);
    store.destroy();
  });
});
