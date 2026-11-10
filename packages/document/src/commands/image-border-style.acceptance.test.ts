// Image border styling is one undoable command and image-only.
import { afterEach, describe, expect, it } from 'vitest';

import { createHistory } from '../history/undo-manager.js';
import { ADA, fixtureObject } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, expectRejected } from './__fixtures__/command-fixtures.js';
import { setStyleCommand } from './set-style.js';
import { STYLE_FIELDS_BY_TYPE } from './style-fields.js';

const BORDER = { color: 'ink', width: 2 } as const;
const stores: YjsDocumentStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.destroy();
});

function seeded(): YjsDocumentStore {
  const store = new YjsDocumentStore();
  stores.push(store);
  store.transact(ADA, (transaction) => {
    transaction.setObject(fixtureObject('image-photo', 'image'));
  });
  return store;
}

describe('image border setStyle', () => {
  it('sets and removes a border, each in one undo step', () => {
    const store = seeded();
    const history = createHistory(store, ADA.principalId);
    applyCommand(store, setStyleCommand, {
      changes: [{ id: 'image-photo', style: { border: BORDER } }],
    });
    expect(store.get('image-photo' as never)).toHaveProperty('border', BORDER);
    applyCommand(store, setStyleCommand, {
      changes: [{ id: 'image-photo', style: { border: null } }],
    });
    expect([null, undefined]).toContain(
      Reflect.get(store.get('image-photo' as never) ?? {}, 'border'),
    );
    expect(history.undo()).toBe(true);
    expect(store.get('image-photo' as never)).toHaveProperty('border', BORDER);
    expect(history.undo()).toBe(true);
    expect(store.get('image-photo' as never)).not.toHaveProperty('border');
    expect(history.undo()).toBe(false);
    history.destroy();
  });

  it('refuses border on another object type without changing it', () => {
    for (const [type, fields] of Object.entries(STYLE_FIELDS_BY_TYPE)) {
      if (type !== 'image') expect(fields).not.toContain('border');
    }
    const store = seeded();
    store.transact(ADA, (transaction) => {
      transaction.setObject(fixtureObject('frame-plan', 'frame'));
    });
    const before = store.get('frame-plan' as never);
    const errors = expectRejected(store, setStyleCommand, {
      changes: [{ id: 'frame-plan', style: { border: BORDER } as never }],
    });
    expect(errors.map((error) => error.code)).toEqual(['unsupported-type']);
    expect(store.get('frame-plan' as never)).toEqual(before);
  });
});
