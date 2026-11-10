// What `detachInstance` refuses, each without a write: no object, an object that is no
// instance, an instance whose main a peer removed, and copies whose new ids are already in use.
import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { ADA, RELAY } from '../store/__fixtures__/store-fixtures.js';
import { internalsOf } from '../store/internal.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { expectRejected, testEnvironment } from './__fixtures__/command-fixtures.js';
import {
  placeInstance,
  seedLeafMain,
  seedMainWithChildren,
} from './__fixtures__/component-boards.js';
import { mustFindCommand } from './__fixtures__/component-fixtures.js';
import { runCommand } from './run-command.js';

const detach = mustFindCommand('detachInstance');

describe('detachInstance refusals', () => {
  it('refuses a missing object and one that is no instance', () => {
    const store = new YjsDocumentStore();
    seedLeafMain(store, 'main-leaf', { x: 0, y: 0 });
    expect(expectRejected(store, detach, { id: 'nowhere' })[0]?.objectId).toBe('nowhere');
    expect(expectRejected(store, detach, { id: 'main-leaf' })).toEqual([
      expect.objectContaining({ code: 'unsupported-type', objectId: 'main-leaf' }),
    ]);
  });

  it('refuses an instance whose main a peer removed, naming its main', () => {
    const store = new YjsDocumentStore();
    seedLeafMain(store, 'main-leaf', { x: 0, y: 0 });
    placeInstance(store, 'main-leaf', { x: 1000, y: 0, instanceId: 'inst-1' });
    const { doc, objects } = internalsOf(store);
    doc.transact(() => {
      objects.delete('main-leaf');
    }, RELAY);
    expect(expectRejected(store, detach, { id: 'inst-1' })).toEqual([
      expect.objectContaining({ objectId: 'inst-1', path: ['mainId'] }),
    ]);
  });

  it('refuses copies given ids already in use', () => {
    const store = new YjsDocumentStore();
    const card = seedMainWithChildren(store);
    placeInstance(store, card.mainId, { x: 1000, y: 0, instanceId: 'inst-1' });
    const before = store.encodeState();
    const environment = { ...testEnvironment(), createId: () => card.boxId as ObjectId };
    const outcome = runCommand(store, ADA, detach, { id: 'inst-1' }, environment);
    expect(outcome.status).toBe('rejected');
    const codes = outcome.status === 'rejected' ? outcome.errors.map(({ code }) => code) : [];
    expect(codes).toContain('duplicate-id');
    expect(store.encodeState()).toEqual(before);
  });
});
