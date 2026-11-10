import { describe, expect, it, vi } from 'vitest';

import { findCommand, runCommand, YjsDocumentStore } from '@canvas/document';
import {
  createSeededIdGenerator,
  type BoardObject,
  type ObjectId,
  type PageId,
  type PrincipalId,
} from '@canvas/schema';

import { PageIndex } from './page-index.js';
import { PageScopedStore } from './page-scoped-store.js';

const ORIGIN = { kind: 'user', principalId: 'user:ada' as PrincipalId } as const;
const ENVIRONMENT = { clock: () => 1, createId: createSeededIdGenerator(7) };

/**
 * A rectangle at the root of Page 1.
 *
 * @param id - Its id.
 * @returns The object.
 */
function rect(id: string): BoardObject {
  return {
    id: id as ObjectId,
    type: 'shape',
    parentId: null,
    x: 0,
    y: 0,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: ORIGIN.principalId,
    createdAt: 1,
    updatedAt: 1,
    width: 10,
    height: 10,
    kind: 'rectangle',
    cornerRadius: 0,
    sides: 4,
    label: null,
    stroke: null,
    fill: [1, 0, 0, 1],
  };
}

/**
 * A whole board and the view of its first page.
 *
 * @returns Both.
 */
function setup() {
  const store = new YjsDocumentStore();
  const view = new PageScopedStore(store, new PageIndex(store), 'page-1' as PageId);
  return { store, view };
}

/**
 * Runs a registered command on the whole board and returns its result.
 *
 * @param store - The board.
 * @param name - The command's name.
 * @param input - Its input.
 * @returns The command's result.
 * @throws {Error} When the command is not registered or does not apply.
 */
function run(store: YjsDocumentStore, name: string, input: unknown): unknown {
  const command = findCommand(name);
  if (command === undefined) throw new Error(`${name} is registered`);
  const outcome = runCommand(store, ORIGIN, command, input, ENVIRONMENT);
  if (outcome.status !== 'applied') throw new Error(`${name} applies`);
  return outcome.result;
}

describe('PageScopedStore', () => {
  it('passes sync and repair to the whole board', () => {
    const { store, view } = setup();
    const updates = vi.fn();
    const stop = view.subscribeUpdates(updates);
    view.setRepairMode('write');
    view.transact(ORIGIN, (tx) => {
      tx.setObject(rect('one'));
    });
    expect(updates).toHaveBeenCalled();
    stop();
    expect(view.encodeStateVector()).toEqual(store.encodeStateVector());
    expect(view.encodeState()).toEqual(store.encodeState());
    expect(view.encodeSyncState()).toEqual(store.encodeSyncState());
    expect(view.hasPendingStructs).toBe(store.hasPendingStructs);
    const other = new YjsDocumentStore();
    const otherView = new PageScopedStore(other, new PageIndex(other), 'page-1' as PageId);
    otherView.applyUpdate(view.encodeState(), ORIGIN);
    expect(otherView.get('one' as ObjectId)?.id).toBe('one');
    otherView.destroy();
    other.destroy();
    view.destroy();
    store.destroy();
  });

  it('ignores showing the page shown, and rethrows the first error a listener threw', () => {
    const { store, view } = setup();
    const seen = vi.fn();
    view.subscribe(() => {
      throw new Error('first');
    });
    view.subscribe(() => {
      throw new Error('second');
    });
    view.subscribe(seen);
    view.show('page-1' as PageId);
    expect(seen).not.toHaveBeenCalled();
    expect(() => {
      view.show('p2' as PageId);
    }).toThrow('first');
    expect(seen).toHaveBeenCalledTimes(1);
    view.destroy();
    store.destroy();
  });

  it('lists only the instances of a main that sit on the page shown', () => {
    const store = new YjsDocumentStore();
    store.transact(ORIGIN, (tx) => {
      tx.setObject(rect('one'));
    });
    const { pageId: second } = run(store, 'addPage', {}) as { pageId: PageId };
    run(store, 'createComponent', { ids: ['one'], name: 'Card', componentId: 'main' });
    run(store, 'createInstance', { componentId: 'main', x: 100, y: 0, instanceId: 'here' });
    run(store, 'createInstance', {
      componentId: 'main',
      x: 100,
      y: 0,
      instanceId: 'there',
      pageId: second,
    });
    const main = 'main' as ObjectId;
    expect([...store.references.instancesOf(main)].sort()).toEqual(['here', 'there']);
    const view = new PageScopedStore(store, new PageIndex(store), 'page-1' as PageId);
    expect([...view.references.instancesOf(main)]).toEqual(['here']);
    view.show(second);
    expect([...view.references.instancesOf(main)]).toEqual(['there']);
    view.destroy();
    store.destroy();
  });

  it('reports the whole board’s Yjs client id as its own', () => {
    const store = new YjsDocumentStore({ clientId: 4242 });
    const view = new PageScopedStore(store, new PageIndex(store), 'page-1' as PageId);
    expect(view.clientId).toBe(4242);
    view.destroy();
    store.destroy();
  });
});
