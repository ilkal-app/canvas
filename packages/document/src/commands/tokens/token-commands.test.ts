import { describe, expect, it } from 'vitest';

import {
  BUILTIN_TOKEN_DEFAULTS,
  MAX_CUSTOM_TOKENS,
  validateBoard,
  type Rgba,
  type TokenEntry,
} from '@canvas/schema';

import { SCOUT_FOR_ADA } from '../../history/__fixtures__/history-fixtures.js';
import { createHistory } from '../../history/undo-manager.js';
import type { TransactionOrigin } from '../../origin/transaction-origin.js';
import { ADA, BOB, createFixtureStore } from '../../store/__fixtures__/store-fixtures.js';
import type { ChangeSet, DocumentStore } from '../../store/document-store.js';
import {
  applyCommand,
  expectRejected,
  mustGet,
  testEnvironment,
} from '../__fixtures__/command-fixtures.js';
import type { AnyCommand } from '../command.js';
import { runCommand } from '../run-command.js';
import { setStyleCommand } from '../set-style.js';

import { deleteColorTokenCommand } from './delete-color-token.js';
import { renameColorTokenCommand } from './rename-color-token.js';
import { resetColorTokenCommand } from './reset-color-token.js';
import { setColorTokenCommand } from './set-color-token.js';

const RED: Rgba = [1, 0, 0, 1];
const BLUE: Rgba = [0, 0, 1, 1];
const GREEN: Rgba = [0, 1, 0, 1];

const codes = (errors: readonly { readonly code: string }[]): string[] =>
  errors.map(({ code }) => code);

/**
 * Creates a custom token as someone.
 *
 * @param store - The store.
 * @param name - Its name.
 * @param origin - Who creates it.
 * @param seed - The id generator's seed.
 * @returns The new token's id.
 */
function create(
  store: DocumentStore,
  name: string,
  origin: TransactionOrigin = ADA,
  seed = 3,
): string {
  const input = { name, light: RED, dark: BLUE };
  return applyCommand(store, setColorTokenCommand, input, origin, testEnvironment(seed)).result.id;
}

/**
 * Runs a command as someone, expecting a refusal, and reads the codes.
 *
 * @param store - The store.
 * @param command - The command.
 * @param input - Its input.
 * @param origin - Who runs it.
 * @returns The refusal codes.
 */
function refusal(
  store: DocumentStore,
  command: AnyCommand,
  input: unknown,
  origin: TransactionOrigin,
): string[] {
  const before = store.encodeState();
  const outcome = runCommand(store, origin, command, input, testEnvironment());
  expect(store.encodeState()).toEqual(before);
  return outcome.status === 'rejected' ? codes(outcome.errors) : [];
}

/**
 * Reads a token entry.
 *
 * @param store - The store.
 * @param id - The token.
 * @returns The entry, or undefined.
 */
function entryOf(store: DocumentStore, id: string): TokenEntry | undefined {
  return store.readTokens().get(id);
}

describe('setColorToken', () => {
  it('creates a custom token with a fresh id, recorded in the snapshot and change set', () => {
    const store = createFixtureStore();
    const seen: ChangeSet[] = [];
    store.subscribe((changes) => seen.push(changes));
    const id = create(store, 'Brand');
    expect(entryOf(store, id)).toEqual({
      id,
      name: 'Brand',
      light: RED,
      dark: BLUE,
      builtin: false,
      createdBy: 'user:ada',
      createdAt: expect.any(Number) as number,
    });
    expect(store.read().tokens?.get(id)?.name).toBe('Brand');
    expect(seen).toEqual([expect.objectContaining({ created: [], updated: [], tokens: [id] })]);
    store.destroy();
  });

  it('updates a token, edits a built-in, and is one undo step each', () => {
    const store = createFixtureStore();
    const history = createHistory(store, ADA.principalId);
    const id = create(store, 'Brand');
    applyCommand(store, setColorTokenCommand, { id, name: 'Brand 2', light: GREEN, dark: BLUE });
    expect(entryOf(store, id)).toMatchObject({ name: 'Brand 2', light: GREEN });
    applyCommand(store, setColorTokenCommand, {
      id: 'accent',
      name: 'ignored',
      light: GREEN,
      dark: RED,
    });
    expect(entryOf(store, 'accent')).toMatchObject({ name: 'accent', builtin: true, light: GREEN });
    expect(history.undo()).toBe(true);
    expect(entryOf(store, 'accent')).toBeUndefined();
    expect(history.undo()).toBe(true);
    expect(entryOf(store, id)).toMatchObject({ name: 'Brand', light: RED });
    expect(history.undo()).toBe(true);
    expect(entryOf(store, id)).toBeUndefined();
    expect(history.redo()).toBe(true);
    expect(entryOf(store, id)).toMatchObject({ name: 'Brand' });
    store.destroy();
  });

  it('refuses a missing id, a taken name and a board at the token limit', () => {
    const store = createFixtureStore();
    const input = { light: RED, dark: BLUE };
    expect(
      codes(expectRejected(store, setColorTokenCommand, { ...input, id: 'gone', name: 'X' })),
    ).toEqual(['missing-token']);
    create(store, 'Brand');
    expect(
      codes(expectRejected(store, setColorTokenCommand, { ...input, name: ' brand ' })),
    ).toEqual(['duplicate-token-name']);
    expect(
      codes(expectRejected(store, setColorTokenCommand, { ...input, name: 'Accent' })),
    ).toEqual(['duplicate-token-name']);
    const blank = codes(expectRejected(store, setColorTokenCommand, { ...input, name: '' }));
    expect(new Set(blank)).toEqual(new Set(['invalid-input']));
    for (let index = 1; index < MAX_CUSTOM_TOKENS; index += 1) {
      create(store, `T${String(index)}`, ADA, 100 + index);
    }
    expect(
      codes(expectRejected(store, setColorTokenCommand, { ...input, name: 'One more' })),
    ).toEqual(['too-many-tokens']);
    store.destroy();
  });

  it('draws past ids the board already has, as many as it has', () => {
    const store = createFixtureStore();
    const ids = new Set<string>();
    for (let index = 0; index < 20; index += 1)
      ids.add(create(store, `Same seed ${String(index)}`));
    expect(ids.size).toBe(20);
  });

  it('writes nothing when a token already reads as given', () => {
    const store = createFixtureStore();
    const id = create(store, 'Brand');
    const before = store.encodeState();
    const { result } = applyCommand(store, setColorTokenCommand, {
      id,
      name: 'Brand',
      light: RED,
      dark: BLUE,
    });
    expect(result.isChanged).toBe(false);
    expect(store.encodeState()).toEqual(before);
    store.destroy();
  });
});

describe('renaming, deleting and resetting tokens', () => {
  it('renames and deletes a custom token, leaving objects naming it as unknown notices', () => {
    const store = createFixtureStore();
    const id = create(store, 'Brand');
    applyCommand(store, renameColorTokenCommand, { id, name: 'Logo' });
    expect(entryOf(store, id)?.name).toBe('Logo');
    applyCommand(store, setStyleCommand, {
      changes: [{ id: 'shape-box', style: { fill: { token: id } } }],
    });
    expect(validateBoard(store.read())).toEqual([]);
    applyCommand(store, deleteColorTokenCommand, { id });
    expect(entryOf(store, id)).toBeUndefined();
    expect(mustGet(store, 'shape-box')).toMatchObject({ fill: { token: id } });
    expect(validateBoard(store.read()).map(({ code }) => code)).toEqual(['unknown-color-token']);
    store.destroy();
  });

  it('refuses renaming or deleting a built-in, and resets an edited one', () => {
    const store = createFixtureStore();
    expect(codes(expectRejected(store, renameColorTokenCommand, { id: 'ink', name: 'X' }))).toEqual(
      ['builtin-token'],
    );
    expect(codes(expectRejected(store, deleteColorTokenCommand, { id: 'accent' }))).toEqual([
      'builtin-token',
    ]);
    expect(codes(expectRejected(store, deleteColorTokenCommand, { id: 'gone' }))).toEqual([
      'missing-token',
    ]);
    expect(codes(expectRejected(store, resetColorTokenCommand, { id: 'custom' }))).toEqual([
      'invalid-input',
    ]);
    expect(applyCommand(store, resetColorTokenCommand, { id: 'muted' }).result.isChanged).toBe(
      false,
    );
    applyCommand(store, setColorTokenCommand, {
      id: 'muted',
      name: 'muted',
      light: RED,
      dark: RED,
    });
    expect(applyCommand(store, resetColorTokenCommand, { id: 'muted' }).result.isChanged).toBe(
      true,
    );
    expect(entryOf(store, 'muted')).toBeUndefined();
    expect(BUILTIN_TOKEN_DEFAULTS.muted.light).not.toEqual(RED);
    store.destroy();
  });
});

describe('the agent rule for tokens', () => {
  it('lets an agent create and change its own tokens, never others or built-ins', () => {
    const store = createFixtureStore();
    const own = create(store, 'Agent colour', SCOUT_FOR_ADA, 5);
    expect(entryOf(store, own)?.createdBy).toBe(SCOUT_FOR_ADA.principalId);
    applyCommand(store, renameColorTokenCommand, { id: own, name: 'Mine' }, SCOUT_FOR_ADA);
    applyCommand(store, deleteColorTokenCommand, { id: own }, SCOUT_FOR_ADA);
    const theirs = create(store, 'People colour', BOB, 6);
    const input = { id: theirs, name: 'Taken', light: GREEN, dark: GREEN };
    expect(refusal(store, setColorTokenCommand, input, SCOUT_FOR_ADA)).toEqual(['not-own-token']);
    expect(
      refusal(store, renameColorTokenCommand, { id: theirs, name: 'X' }, SCOUT_FOR_ADA),
    ).toEqual(['not-own-token']);
    expect(refusal(store, deleteColorTokenCommand, { id: theirs }, SCOUT_FOR_ADA)).toEqual([
      'not-own-token',
    ]);
    const builtin = { id: 'accent', name: 'accent', light: GREEN, dark: GREEN };
    expect(refusal(store, setColorTokenCommand, builtin, SCOUT_FOR_ADA)).toEqual(['not-own-token']);
    expect(refusal(store, resetColorTokenCommand, { id: 'accent' }, SCOUT_FOR_ADA)).toEqual([
      'not-own-token',
    ]);
    applyCommand(store, deleteColorTokenCommand, { id: theirs }, ADA);
    store.destroy();
  });
});

describe('setStyle with tokens and colour modes', () => {
  it('sets token colours and a frame colour mode, and clears the mode with null', () => {
    const store = createFixtureStore();
    applyCommand(store, setStyleCommand, {
      changes: [
        { id: 'shape-box', style: { stroke: { color: { token: 'text' }, width: 2 } } },
        { id: 'sticky-idea', style: { color: { token: 'surface' } } },
        { id: 'frame-plan', style: { colorMode: 'dark', background: { token: 'surface' } } },
        { id: 'text-title', style: { textStyle: { color: { token: 'accent' } } } },
      ],
    });
    expect(mustGet(store, 'frame-plan')).toMatchObject({ colorMode: 'dark' });
    expect(mustGet(store, 'sticky-idea')).toMatchObject({ color: { token: 'surface' } });
    const title = mustGet(store, 'text-title');
    expect(
      title.type === 'text' && title.runs.every(({ style }) => 'token' in (style.color as object)),
    ).toBe(true);
    applyCommand(store, setStyleCommand, {
      changes: [{ id: 'frame-plan', style: { colorMode: null } }],
    });
    expect(mustGet(store, 'frame-plan')).toMatchObject({ colorMode: undefined });
    store.destroy();
  });

  it('refuses a colour mode on a shape and the literal ink in a fill', () => {
    const store = createFixtureStore();
    expect(
      codes(
        expectRejected(store, setStyleCommand, {
          changes: [{ id: 'shape-box', style: { colorMode: 'dark' } }],
        }),
      ),
    ).toEqual(['unsupported-type']);
    expect(
      codes(
        expectRejected(store, setStyleCommand, {
          changes: [{ id: 'shape-box', style: { fill: 'ink' } }],
        }),
      ),
    ).toEqual(['invalid-input']);
    store.destroy();
  });
});
