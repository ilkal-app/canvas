// Colour tokens and the objects that use them in one command and one undo step.
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { MAX_CUSTOM_TOKENS, type Rgba } from '@canvas/schema';

import { SCOUT_FOR_ADA } from '../../history/__fixtures__/history-fixtures.js';
import { createHistory } from '../../history/undo-manager.js';
import { ADA, createFixtureStore } from '../../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../../store/yjs-document-store.js';
import {
  applyCommand,
  expectRejected,
  mustGet,
  testEnvironment,
} from '../__fixtures__/command-fixtures.js';
import { MAX_OBJECTS_PER_TRANSACTION } from '../create-objects-parts.js';
import { runCommand } from '../run-command.js';

import {
  createObjectsWithTokensCommand,
  MAX_TOKEN_ITEMS,
  type createObjectsWithTokensInputSchema,
} from './create-objects-with-tokens.js';
import { setColorTokenCommand } from './set-color-token.js';

const RED: Rgba = [1, 0, 0, 1];
const BLUE: Rgba = [0, 0, 1, 1];

/** The input, before parsing. */
type Input = z.input<typeof createObjectsWithTokensInputSchema>;

/**
 * A rectangle filled with a token, listed under an id.
 *
 * @param listedId - Its id in the list.
 * @param token - The token its fill names.
 * @returns The entry.
 */
function rectangle(listedId: string, token: string): Input['objects'][number] {
  return {
    type: 'shape',
    id: listedId,
    parentId: null,
    x: 0,
    y: 0,
    width: 40,
    height: 30,
    kind: 'rectangle',
    stroke: null,
    fill: { token },
    cornerRadius: 0,
    sides: 4,
    label: null,
  };
}

/**
 * A token item that creates a token.
 *
 * @param name - Its name.
 * @returns The item.
 */
function token(name: string): { name: string; light: Rgba; dark: Rgba } {
  return { name, light: RED, dark: BLUE };
}

const codesAt = (errors: readonly { code: string; path: readonly unknown[] }[]): string[] =>
  errors.map(({ code, path }) => `${code} ${path.join('.')}`);

describe('createObjectsWithTokens', () => {
  it('writes the tokens, then the objects naming them, as one undo step', () => {
    const store = createFixtureStore();
    const history = createHistory(store, ADA.principalId);
    const { result } = applyCommand(store, createObjectsWithTokensCommand, {
      tokens: [token('Brand'), token('Night')],
      newTokenIds: ['brand', 'night'],
      objects: [rectangle('a', 'brand'), rectangle('b', 'night')],
    });
    expect(result.tokens).toEqual([
      { id: 'brand', isCreated: true, isChanged: true },
      { id: 'night', isCreated: true, isChanged: true },
    ]);
    expect(store.readTokens().get('brand')).toMatchObject({
      name: 'Brand',
      createdBy: ADA.principalId,
    });
    expect(mustGet(store, result.ids[1] ?? '')).toMatchObject({ fill: { token: 'night' } });
    expect(history.undo()).toBe(true);
    expect(store.readTokens().size).toBe(0);
    expect(result.ids.every((objectId) => store.get(objectId) === undefined)).toBe(true);
    store.destroy();
  });

  it('draws fresh ids without newTokenIds, and updates an earlier token in place', () => {
    const store = createFixtureStore();
    const existing = applyCommand(store, setColorTokenCommand, token('Old')).result.id;
    const { result } = applyCommand(
      store,
      createObjectsWithTokensCommand,
      {
        tokens: [token('Fresh'), { id: existing, name: 'Renamed', light: BLUE, dark: RED }],
        objects: [rectangle('a', existing)],
      },
      ADA,
      testEnvironment(11),
    );
    const [fresh, updated] = result.tokens;
    expect(fresh).toMatchObject({ isCreated: true, isChanged: true });
    expect(fresh?.id).not.toBe(existing);
    expect(updated).toEqual({ id: existing, isCreated: false, isChanged: true });
    expect(store.readTokens().get(existing)).toMatchObject({ name: 'Renamed', light: BLUE });
    store.destroy();
  });

  it('sees earlier items: a repeated name in one call is refused at the later item', () => {
    const store = createFixtureStore();
    const errors = expectRejected(store, createObjectsWithTokensCommand, {
      tokens: [token('Brand Blue'), token(' brand blue ')],
      objects: [rectangle('a', 'accent')],
    });
    expect(codesAt(errors)).toEqual(['duplicate-token-name tokens.1.name']);
    store.destroy();
  });

  it('counts its own items toward the custom-token limit', () => {
    const store = createFixtureStore();
    const tokens = [...Array(MAX_CUSTOM_TOKENS + 1).keys()].map((index) =>
      token(`Colour ${String(index)}`),
    );
    const errors = expectRejected(store, createObjectsWithTokensCommand, {
      tokens,
      objects: [rectangle('a', 'accent')],
    });
    expect(codesAt(errors)).toEqual([`too-many-tokens tokens.${String(MAX_CUSTOM_TOKENS)}`]);
    store.destroy();
  });

  it('refuses a chosen id the board already has, and an agent changing a built-in', () => {
    const store = createFixtureStore();
    const taken = applyCommand(store, setColorTokenCommand, token('Taken')).result.id;
    const errors = expectRejected(store, createObjectsWithTokensCommand, {
      tokens: [token('Brand')],
      newTokenIds: [taken],
      objects: [rectangle('a', 'accent')],
    });
    expect(codesAt(errors)).toEqual(['duplicate-id tokens.0.id']);
    const before = store.encodeState();
    const outcome = runCommand(
      store,
      SCOUT_FOR_ADA,
      createObjectsWithTokensCommand,
      { tokens: [{ id: 'accent', ...token('accent') }], objects: [rectangle('a', 'accent')] },
      testEnvironment(),
    );
    expect(outcome.status === 'rejected' ? codesAt(outcome.errors) : []).toEqual([
      'not-own-token tokens.0.id',
    ]);
    expect(store.encodeState()).toEqual(before);
    store.destroy();
  });

  it('refuses more chosen ids than token items that create a token', () => {
    const store = createFixtureStore();
    const errors = expectRejected(store, createObjectsWithTokensCommand, {
      tokens: [token('Brand'), { id: 'accent', ...token('accent') }],
      newTokenIds: ['brand', 'spare'],
      objects: [rectangle('a', 'accent')],
    });
    expect(codesAt(errors)).toEqual(['invalid-input newTokenIds']);
    store.destroy();
  });

  it('refuses the objects and the tokens together, writing neither', () => {
    const store = createFixtureStore();
    const errors = expectRejected(store, createObjectsWithTokensCommand, {
      tokens: [token('Brand')],
      objects: [rectangle('a', 'accent'), rectangle('a', 'accent')],
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(store.readTokens().size).toBe(0);
    store.destroy();
  });

  it('takes 1 to 100 token items', () => {
    expect(MAX_TOKEN_ITEMS).toBe(100);
    const store = createFixtureStore();
    for (const count of [0, MAX_TOKEN_ITEMS + 1]) {
      const tokens = [...Array(count).keys()].map((index) => token(`C${String(index)}`));
      expect(
        expectRejected(store, createObjectsWithTokensCommand, {
          tokens,
          objects: [rectangle('a', 'accent')],
        }).length,
      ).toBeGreaterThan(0);
    }
    store.destroy();
  });

  it('writes the tokens in the first part of a split creation, still one undo step', () => {
    const store = new YjsDocumentStore();
    const history = createHistory(store, ADA.principalId);
    let updates = 0;
    store.subscribeUpdates(({ isLocal }) => {
      if (isLocal) updates += 1;
    });
    const objects = [...Array(MAX_OBJECTS_PER_TRANSACTION + 1).keys()].map((index) =>
      rectangle(`r${String(index)}`, 'brand'),
    );
    const { result } = applyCommand(store, createObjectsWithTokensCommand, {
      tokens: [token('Brand')],
      newTokenIds: ['brand'],
      objects,
    });
    expect(updates).toBe(2);
    expect(result.ids).toHaveLength(objects.length);
    expect(result.tokens).toEqual([{ id: 'brand', isCreated: true, isChanged: true }]);
    expect(store.readTokens().get('brand')?.name).toBe('Brand');
    expect(history.undo()).toBe(true);
    expect(store.readTokens().size).toBe(0);
    expect(store.read().objects.size).toBe(0);
    store.destroy();
  });
});
