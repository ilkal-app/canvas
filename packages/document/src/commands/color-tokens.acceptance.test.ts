// Independent acceptance for token commands and convergence.
import { describe, expect, it } from 'vitest';

import type { PrincipalId } from '@canvas/schema';

import { createHistory } from '../history/undo-manager.js';
import {
  RELAY,
  ADA,
  BOB,
  exchange,
  createFixtureStore,
  fixtureObject,
} from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand } from './__fixtures__/command-fixtures.js';
import { codesOf, expectRefusedBy } from './__fixtures__/component-fixtures.js';
import { findCommand } from './registry.js';
import { setStyleCommand, setStyleInputSchema } from './set-style.js';

const RED = [1, 0, 0, 1] as const;
const BLUE = [0, 0, 1, 1] as const;
const GREEN = [0, 1, 0, 1] as const;
const origin = {
  kind: 'agent' as const,
  principalId: 'agent:scout' as PrincipalId,
  operatorId: ADA.principalId,
};

function command(name: string) {
  const found = findCommand(name);
  if (found === undefined) throw new Error(`missing command: ${name}`);
  return found;
}

function tokens(store: YjsDocumentStore): ReadonlyMap<string, Record<string, unknown>> {
  const table = (
    store.read() as unknown as { tokens?: ReadonlyMap<string, Record<string, unknown>> }
  ).tokens;
  if (table === undefined) throw new Error('missing export: BoardSnapshot.tokens');
  return table;
}

function add(store: YjsDocumentStore, name = 'Brand', as = ADA): string {
  applyCommand(store, command('setColorToken'), { name, light: RED, dark: BLUE }, as);
  const entry = [...tokens(store).entries()].find(([, token]) => token.name === name);
  if (entry === undefined) throw new Error(`token ${name} was not created`);
  return entry[0];
}

function pair(adaClientId: number, bobClientId: number) {
  const ada = new YjsDocumentStore({ clientId: adaClientId });
  const bob = new YjsDocumentStore({ clientId: bobClientId });
  const id = add(ada);
  bob.applyUpdate(ada.encodeState(), RELAY);
  return { ada, bob, id };
}

describe('token commands', () => {
  it('creates a fresh id and exposes tokens in BoardSnapshot, one undo step', () => {
    const store = new YjsDocumentStore();
    const history = createHistory(store, ADA.principalId);
    const id = add(store);
    expect(id).not.toBe('ink');
    expect(tokens(store).get(id)).toMatchObject({ name: 'Brand', light: RED, dark: BLUE });
    expect(history.undo()).toBe(true);
    expect(tokens(store).has(id)).toBe(false);
    history.destroy();
  });

  it('updates, renames, deletes and resets a built-in in one undo step each', () => {
    const store = new YjsDocumentStore();
    const id = add(store);
    const history = createHistory(store, ADA.principalId);
    applyCommand(store, command('setColorToken'), { id, name: 'Brand', light: BLUE, dark: RED });
    expect(tokens(store).get(id)).toMatchObject({ light: BLUE });
    expect(history.undo()).toBe(true);
    expect(tokens(store).get(id)).toMatchObject({ light: RED });
    applyCommand(store, command('renameColorToken'), { id, name: 'Renamed' });
    expect(tokens(store).get(id)).toMatchObject({ name: 'Renamed' });
    expect(history.undo()).toBe(true);
    applyCommand(store, command('deleteColorToken'), { id });
    expect(tokens(store).has(id)).toBe(false);
    expect(history.undo()).toBe(true);
    applyCommand(store, command('setColorToken'), {
      id: 'accent',
      name: 'Accent',
      light: RED,
      dark: BLUE,
    });
    expect(tokens(store).has('accent')).toBe(true);
    applyCommand(store, command('resetColorToken'), { id: 'accent' });
    expect(tokens(store).has('accent')).toBe(false);
    expect(history.undo()).toBe(true);
    expect(tokens(store).has('accent')).toBe(true);
    history.destroy();
  });

  it('refuses duplicate and invalid names, a 65th custom token, and deletion of built-ins', () => {
    const store = new YjsDocumentStore();
    add(store);
    for (const name of ['', 'x'.repeat(41), 'Brand']) {
      expect(
        codesOf(
          expectRefusedBy(store, ADA, command('setColorToken'), { name, light: RED, dark: BLUE }),
        ),
      ).not.toEqual([]);
    }
    for (let index = 1; index < 64; index++) add(store, `Brand ${String(index)}`);
    expect(
      codesOf(
        expectRefusedBy(store, ADA, command('setColorToken'), {
          name: 'Overflow',
          light: RED,
          dark: BLUE,
        }),
      ),
    ).toContain('too-many-tokens');
    expect(
      codesOf(expectRefusedBy(store, ADA, command('deleteColorToken'), { id: 'ink' })),
    ).toContain('builtin-token');
  });

  it('setStyle accepts token refs and a frame colorMode', () => {
    const store = createFixtureStore();
    expect(
      setStyleInputSchema.safeParse({
        changes: [
          {
            id: 'shape-box',
            style: { fill: { token: 'accent' }, stroke: { color: { token: 'accent' }, width: 2 } },
          },
        ],
      }).success,
    ).toBe(true);
    applyCommand(store, setStyleCommand, {
      changes: [
        { id: 'frame-plan', style: { colorMode: 'dark', background: { token: 'surface' } } },
      ],
    } as never);
    expect(store.get('frame-plan' as never)).toMatchObject({
      colorMode: 'dark',
      background: { token: 'surface' },
    });
    applyCommand(store, setStyleCommand, {
      changes: [{ id: 'shape-box', style: { fill: { token: 'accent' } } }],
    });
    expect(store.get('shape-box' as never)).toMatchObject({ fill: { token: 'accent' } });
  });

  it('lets an agent create and edit its own token, but refuses foreign and built-in edits', () => {
    const store = new YjsDocumentStore();
    const foreign = add(store);
    const owned = add(store, 'Scout', origin);
    applyCommand(store, command('renameColorToken'), { id: owned, name: 'Scout ink' }, origin);
    applyCommand(
      store,
      command('setColorToken'),
      { id: owned, name: 'Scout ink', light: BLUE, dark: RED },
      origin,
    );
    for (const name of ['setColorToken', 'renameColorToken', 'deleteColorToken']) {
      const input =
        name === 'setColorToken'
          ? { id: foreign, name: 'Brand', light: BLUE, dark: RED }
          : name === 'renameColorToken'
            ? { id: foreign, name: 'Other' }
            : { id: foreign };
      expect(codesOf(expectRefusedBy(store, origin, command(name), input))).toContain(
        'not-own-token',
      );
    }
    expect(
      codesOf(
        expectRefusedBy(store, origin, command('setColorToken'), {
          id: 'accent',
          name: 'Accent',
          light: RED,
          dark: BLUE,
        }),
      ),
    ).toContain('not-own-token');
    applyCommand(store, command('deleteColorToken'), { id: owned }, origin);
    expect(tokens(store).has(owned)).toBe(false);
  });
});

describe.each([
  [1, 2],
  [2, 1],
])('two-client token sync (%i, %i)', (a, b) => {
  it('merges different fields of one token and converges an edit against delete', () => {
    const { ada, bob, id } = pair(a, b);
    applyCommand(ada, command('renameColorToken'), { id, name: 'New brand' });
    applyCommand(
      bob,
      command('setColorToken'),
      { id, name: 'Brand', light: GREEN, dark: BLUE },
      BOB,
    );
    exchange(ada, bob);
    expect(tokens(ada)).toEqual(tokens(bob));
    expect(tokens(ada).get(id)).toMatchObject({ name: 'New brand', light: GREEN });
    applyCommand(ada, command('deleteColorToken'), { id });
    applyCommand(bob, command('renameColorToken'), { id, name: 'Late' }, BOB);
    exchange(ada, bob);
    expect(tokens(ada)).toEqual(tokens(bob));
    expect(tokens(ada).has(id)).toBe(false);
  });

  it('converges a token edit racing an object edit', () => {
    const { ada, bob, id } = pair(a, b);
    const shape = { ...fixtureObject('shape-box', 'shape'), parentId: null };
    ada.transact(ADA, (transaction) => {
      transaction.setObject(shape);
    });
    exchange(ada, bob);
    applyCommand(ada, command('setColorToken'), { id, name: 'Brand', light: GREEN, dark: BLUE });
    const edited = { ...shape, fill: { token: id } } as unknown as typeof shape;
    bob.transact(BOB, (transaction) => {
      transaction.setObject(edited);
    });
    exchange(ada, bob);
    expect(tokens(ada)).toEqual(tokens(bob));
    expect(ada.get(shape.id)).toEqual(bob.get(shape.id));
    expect(ada.get(shape.id)).toMatchObject({ fill: { token: id } });
    expect(tokens(ada).get(id)).toMatchObject({ light: GREEN });
  });
});
