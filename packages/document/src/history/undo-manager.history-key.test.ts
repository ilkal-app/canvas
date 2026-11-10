import { describe, expect, it } from 'vitest';

import type { PrincipalId } from '@canvas/schema';

import { applyCommand } from '../commands/__fixtures__/command-fixtures.js';
import { moveObjectsCommand } from '../commands/move-objects.js';
import { parseTransactionOrigin } from '../origin/transaction-origin.js';
import { createFixtureStore } from '../store/__fixtures__/store-fixtures.js';

import { createHistory } from './undo-manager.js';

const ADA = 'user:ada' as PrincipalId;
const scout = (historyKey?: string) =>
  parseTransactionOrigin({
    kind: 'agent',
    principalId: 'agent:scout',
    operatorId: ADA,
    ...(historyKey === undefined ? {} : { historyKey }),
  });

describe('createHistory with a history key', () => {
  it('refuses a key that does not match the pattern', () => {
    const store = createFixtureStore();
    try {
      for (const historyKey of ['', 'a b', 'a'.repeat(65)]) {
        expect(() => createHistory(store, ADA, { historyKey })).toThrow(RangeError);
      }
      // From an untyped caller: never coerced to a string that could match.
      for (const historyKey of [1, null, ['agent-a']]) {
        expect(() =>
          createHistory(store, ADA, { historyKey: historyKey as unknown as string }),
        ).toThrow(RangeError);
      }
    } finally {
      store.destroy();
    }
  });

  it("records neither another key's undo nor its redo as a step of its own", () => {
    const store = createFixtureStore();
    const keyed = createHistory(store, ADA, { historyKey: 'a' });
    const other = createHistory(store, ADA, { historyKey: 'b' });
    const unkeyed = createHistory(store, ADA);
    try {
      applyCommand(
        store,
        moveObjectsCommand,
        { moves: [{ id: 'image-photo', by: { x: 5, y: 0 } }] },
        scout('a'),
      );
      expect(keyed.undo()).toBe(true);
      expect(keyed.redo()).toBe(true);
      for (const history of [other, unkeyed]) {
        expect(history.canUndo()).toBe(false);
        expect(history.canRedo()).toBe(false);
      }
    } finally {
      keyed.destroy();
      other.destroy();
      unkeyed.destroy();
      store.destroy();
    }
  });

  it("keeps one key's redo across another key's new write", () => {
    const store = createFixtureStore();
    const keyed = createHistory(store, ADA, { historyKey: 'a' });
    try {
      const move = (historyKey: string) =>
        applyCommand(
          store,
          moveObjectsCommand,
          { moves: [{ id: 'video-demo', by: { x: 5, y: 0 } }] },
          scout(historyKey),
        );
      move('a');
      expect(keyed.undo()).toBe(true);
      move('b');
      expect(keyed.canRedo()).toBe(true);
    } finally {
      keyed.destroy();
      store.destroy();
    }
  });
});
