import { describe, expect, it } from 'vitest';

import type { Rgba, TokenTable } from '@canvas/schema';

import {
  applyCommand,
  mustGet,
  testEnvironment,
} from '../commands/__fixtures__/command-fixtures.js';
import { setStyleCommand } from '../commands/set-style.js';
import { setTextRunsCommand } from '../commands/set-text-runs.js';
import { deleteColorTokenCommand } from '../commands/tokens/delete-color-token.js';
import { renameColorTokenCommand } from '../commands/tokens/rename-color-token.js';
import { setColorTokenCommand } from '../commands/tokens/set-color-token.js';
import { ADA, BOB, BODY, createSyncedPair, RELAY } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

// A token's name and values are separate keys of the `tokens` map, so concurrent edits of
// different fields merge, a delete concurrent with an edit leaves the token deleted (the edit's
// key has no identity), and a token edit racing an object edit keeps both. Every case is checked
// in both delivery orders, and the two clients must read the same board.

const RED: Rgba = [1, 0, 0, 1];
const BLUE: Rgba = [0, 0, 1, 1];
const GREEN: Rgba = [0, 1, 0, 1];
const WHITE: Rgba = [1, 1, 1, 1];

/** Two clients with a shared custom token, each recording the updates it writes from here on. */
interface Scene {
  readonly ada: YjsDocumentStore;
  readonly bob: YjsDocumentStore;
  readonly tokenId: string;
  readonly fromAda: Uint8Array[];
  readonly fromBob: Uint8Array[];
}

/**
 * Two synced clients holding the fixture board and a token "Brand", red and blue.
 *
 * @returns The scene.
 */
function scene(): Scene {
  const [ada, bob] = createSyncedPair();
  const input = { name: 'Brand', light: RED, dark: BLUE };
  const tokenId = applyCommand(ada, setColorTokenCommand, input, ADA, testEnvironment(4)).result.id;
  bob.applyUpdate(ada.encodeState(bob.encodeStateVector()), RELAY);
  const fromAda: Uint8Array[] = [];
  const fromBob: Uint8Array[] = [];
  ada.subscribeUpdates(({ update, isLocal }) => {
    if (isLocal) fromAda.push(update);
  });
  bob.subscribeUpdates(({ update, isLocal }) => {
    if (isLocal) fromBob.push(update);
  });
  return { ada, bob, tokenId, fromAda, fromBob };
}

/**
 * Delivers the concurrent updates in one order: Bob's first to a fresh copy of the base, then
 * Ada's, and the reverse to another copy; and each to the other client.
 *
 * @param base - The board before the concurrent edits.
 * @param state - The scene after them.
 * @returns The four boards: Ada, Bob, and the two orders.
 */
function deliver(base: Uint8Array, state: Scene): YjsDocumentStore[] {
  const orders = [
    [...state.fromAda, ...state.fromBob],
    [...state.fromBob, ...state.fromAda],
  ].map((updates) => {
    const copy = new YjsDocumentStore();
    copy.applyUpdate(base, RELAY);
    for (const update of updates) copy.applyUpdate(update, RELAY);
    return copy;
  });
  for (const update of state.fromBob) state.ada.applyUpdate(update, RELAY);
  for (const update of state.fromAda) state.bob.applyUpdate(update, RELAY);
  return [state.ada, state.bob, ...orders];
}

/**
 * The token table as plain data, for comparing clients.
 *
 * @param tokens - The table.
 * @returns Its entries.
 */
function plain(tokens: TokenTable): unknown[] {
  return [...tokens.values()].map((entry) => ({ ...entry }));
}

describe('concurrent token edits', () => {
  it('merges a rename and a recolour of one token, in both orders', () => {
    const state = scene();
    const base = state.ada.encodeState();
    applyCommand(state.ada, renameColorTokenCommand, { id: state.tokenId, name: 'Logo' });
    const recolour = { id: state.tokenId, name: 'Brand', light: GREEN, dark: BLUE };
    applyCommand(state.bob, setColorTokenCommand, recolour, BOB);
    const boards = deliver(base, state);
    for (const board of boards) {
      expect(board.readTokens().get(state.tokenId)).toMatchObject({ name: 'Logo', light: GREEN });
      expect(plain(board.readTokens())).toEqual(plain(boards[0]?.readTokens() ?? new Map()));
    }
  });

  it('merges recolours of the light and the dark value', () => {
    const state = scene();
    const base = state.ada.encodeState();
    const id = state.tokenId;
    applyCommand(state.ada, setColorTokenCommand, { id, name: 'Brand', light: GREEN, dark: BLUE });
    applyCommand(
      state.bob,
      setColorTokenCommand,
      { id, name: 'Brand', light: RED, dark: WHITE },
      BOB,
    );
    for (const board of deliver(base, state)) {
      expect(board.readTokens().get(id)).toMatchObject({ light: GREEN, dark: WHITE });
    }
  });

  it('keeps a token deleted when an edit races its delete, in both orders', () => {
    const state = scene();
    const base = state.ada.encodeState();
    applyCommand(state.ada, deleteColorTokenCommand, { id: state.tokenId });
    const recolour = { id: state.tokenId, name: 'Brand', light: GREEN, dark: GREEN };
    applyCommand(state.bob, setColorTokenCommand, recolour, BOB);
    for (const board of deliver(base, state)) {
      expect(board.readTokens().has(state.tokenId)).toBe(false);
      expect(board.read().tokens?.size).toBe(0);
    }
  });

  it('keeps both a token edit and an object edit that names the token', () => {
    const state = scene();
    const base = state.ada.encodeState();
    const id = state.tokenId;
    applyCommand(state.ada, setColorTokenCommand, { id, name: 'Brand', light: GREEN, dark: BLUE });
    applyCommand(
      state.bob,
      setStyleCommand,
      { changes: [{ id: 'shape-box', style: { fill: { token: id } } }] },
      BOB,
    );
    for (const board of deliver(base, state)) {
      expect(mustGet(board, 'shape-box')).toMatchObject({ fill: { token: id } });
      expect(board.readTokens().get(id)?.light).toEqual(GREEN);
    }
  });

  it('round-trips a token colour in text attributes to a peer', () => {
    const state = scene();
    const style = { ...BODY, color: { token: state.tokenId } };
    applyCommand(state.ada, setTextRunsCommand, {
      id: 'text-title',
      text: 'Hi there',
      runs: [
        { length: 3, style },
        { length: 5, style: BODY },
      ],
    });
    for (const update of state.fromAda) state.bob.applyUpdate(update, RELAY);
    const title = mustGet(state.bob, 'text-title');
    expect(title.type === 'text' ? title.runs : []).toEqual([
      { length: 3, style },
      { length: 5, style: BODY },
    ]);
  });
});
