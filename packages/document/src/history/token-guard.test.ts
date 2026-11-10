import { describe, expect, it } from 'vitest';

import type { Rgba } from '@canvas/schema';

import { applyCommand, testEnvironment } from '../commands/__fixtures__/command-fixtures.js';
import { deleteColorTokenCommand } from '../commands/tokens/delete-color-token.js';
import { renameColorTokenCommand } from '../commands/tokens/rename-color-token.js';
import { setColorTokenCommand } from '../commands/tokens/set-color-token.js';
import { ADA, BOB, createFixtureStore, exchange } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { ADA_ID } from './__fixtures__/history-fixtures.js';
import { createHistory } from './undo-manager.js';

/**
 * Ada's and Bob's stores, holding the fixture board.
 *
 * @returns The stores.
 */
function pair(): [YjsDocumentStore, YjsDocumentStore] {
  const fixture = createFixtureStore();
  const ada = new YjsDocumentStore({ clientId: 438 });
  const bob = new YjsDocumentStore({ clientId: 439 });
  ada.applyUpdate(fixture.encodeState(), ADA);
  fixture.destroy();
  exchange(ada, bob);
  return [ada, bob];
}

const TOKEN: { name: string; light: Rgba; dark: Rgba } = {
  name: 'Brand',
  light: [1, 0, 0, 1],
  dark: [0, 0, 1, 1],
};

describe('the token guard', () => {
  it('keeps a created token once a peer has renamed it, and undoes an untouched one', () => {
    const [ada, bob] = pair();
    const history = createHistory(ada, ADA_ID);
    const input = { ...TOKEN };
    const id = applyCommand(ada, setColorTokenCommand, input, ADA, testEnvironment(3)).result.id;
    exchange(ada, bob);
    applyCommand(bob, renameColorTokenCommand, { id, name: 'Bob' }, BOB);
    exchange(ada, bob);
    history.undo();
    expect(ada.readTokens().get(id)?.name).toBe('Bob');
    const other = applyCommand(
      ada,
      setColorTokenCommand,
      { ...input, name: 'Mine' },
      ADA,
      testEnvironment(4),
    ).result.id;
    expect(history.undo()).toBe(true);
    expect(ada.readTokens().has(other)).toBe(false);
    history.destroy();
    ada.destroy();
    bob.destroy();
  });

  it('restores a deleted token on undo, with its name and values', () => {
    const [ada] = pair();
    const input = { ...TOKEN };
    const id = applyCommand(ada, setColorTokenCommand, input, ADA, testEnvironment(3)).result.id;
    const history = createHistory(ada, ADA_ID);
    applyCommand(ada, deleteColorTokenCommand, { id });
    expect(history.undo()).toBe(true);
    expect(ada.readTokens().get(id)).toMatchObject({ name: 'Brand', light: [1, 0, 0, 1] });
    history.destroy();
    ada.destroy();
  });
});
