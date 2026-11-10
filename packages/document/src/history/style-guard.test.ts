import { describe, expect, it } from 'vitest';

import type { TextStyleValue } from '@canvas/schema';

import { applyCommand, testEnvironment } from '../commands/__fixtures__/command-fixtures.js';
import { setEffectStyleCommand, setTextStyleCommand } from '../commands/styles/set-named-style.js';
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
  const ada = new YjsDocumentStore({ clientId: 480 });
  const bob = new YjsDocumentStore({ clientId: 481 });
  ada.applyUpdate(fixture.encodeState(), ADA);
  fixture.destroy();
  exchange(ada, bob);
  return [ada, bob];
}

const BODY: TextStyleValue = { fontFamily: 'Inter', fontSize: 16, weight: 400, italic: false };

describe('the style guard', () => {
  it('keeps a created text style once a peer has renamed it, and undoes an untouched one', () => {
    const [ada, bob] = pair();
    const history = createHistory(ada, ADA_ID);
    const input = { name: 'Body', value: BODY };
    const id = applyCommand(ada, setTextStyleCommand, input, ADA, testEnvironment(3)).result.id;
    exchange(ada, bob);
    applyCommand(bob, setTextStyleCommand, { id, name: 'Bob', value: BODY }, BOB);
    exchange(ada, bob);
    history.undo();
    expect(ada.readTextStyles().get(id)?.name).toBe('Bob');
    const other = applyCommand(
      ada,
      setEffectStyleCommand,
      {
        name: 'Mine',
        value: { shadows: [{ x: 0, y: 1, blur: 2, spread: 0, color: [0, 0, 0, 1] }] },
      },
      ADA,
      testEnvironment(4),
    ).result.id;
    expect(history.undo()).toBe(true);
    expect(ada.readEffectStyles().has(other)).toBe(false);
    history.destroy();
    ada.destroy();
    bob.destroy();
  });
});
