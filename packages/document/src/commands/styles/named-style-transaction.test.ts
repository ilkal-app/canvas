import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ADA, createFixtureStore } from '../../store/__fixtures__/store-fixtures.js';
import { testEnvironment } from '../__fixtures__/command-fixtures.js';
import { batchCommand } from '../batch-command.js';
import { accept, type Command } from '../command.js';
import { runCommand } from '../run-command.js';

import { deleteEffectStyleCommand, deleteTextStyleCommand } from './delete-named-style.js';
import { setEffectStyleCommand, setTextStyleCommand } from './set-named-style.js';

// A command reads the named styles as its own transaction leaves them, through the
// stamping transaction run-command wraps it in.

const BODY = { fontFamily: 'Inter', fontSize: 16, weight: 400, italic: false } as const;

/** Writes a text style, then reads both tables back inside the same transaction. */
const writeThenRead: Command<z.ZodObject, null, { text: number; effect: number }> = {
  name: 'writeThenRead',
  description: 'Test only.',
  input: z.object({}),
  validate: () => accept(null),
  apply(transaction) {
    transaction.setNamedStyle(
      'text',
      { id: 'body', name: 'Body', value: BODY },
      { createdBy: transaction.origin.principalId, createdAt: 1 },
    );
    return {
      text: transaction.namedStyles('text').size,
      effect: transaction.namedStyles('effect').size,
    };
  },
};

describe('named styles inside a transaction', () => {
  it('reads its own style writes back', () => {
    const store = createFixtureStore();
    const outcome = runCommand(store, ADA, writeThenRead, {}, testEnvironment());
    expect(outcome).toMatchObject({ status: 'applied', result: { text: 1, effect: 0 } });
    expect(store.readTextStyles().get('body')).toMatchObject({ name: 'Body', value: BODY });
    store.destroy();
  });

  it('reads and deletes styles through a batch', () => {
    const store = createFixtureStore();
    const batch = runCommand(
      store,
      ADA,
      batchCommand(writeThenRead, 'items'),
      { items: [{}] },
      testEnvironment(),
    );
    expect(batch).toMatchObject({ status: 'applied', result: { items: [{ text: 1, effect: 0 }] } });
    const deleted = runCommand(
      store,
      ADA,
      batchCommand(deleteTextStyleCommand, 'styles'),
      { styles: [{ id: 'body' }] },
      testEnvironment(),
    );
    expect(deleted.status).toBe('applied');
    expect(store.readTextStyles().has('body')).toBe(false);
    const shadow = {
      x: 0,
      y: 4,
      blur: 4,
      spread: 0,
      color: [0, 0, 0, 0.25] as [number, number, number, number],
    };
    const effect = runCommand(
      store,
      ADA,
      setEffectStyleCommand,
      { name: 'Depth', value: { shadows: [shadow] } },
      testEnvironment(),
    );
    if (effect.status !== 'applied') throw new Error('the effect style is made');
    const removed = runCommand(
      store,
      ADA,
      batchCommand(deleteEffectStyleCommand, 'styles'),
      { styles: [{ id: effect.result.id }] },
      testEnvironment(),
    );
    expect(removed.status).toBe('applied');
    expect(store.readEffectStyles().size).toBe(0);
    store.destroy();
  });

  it('shows a batch item the styles the earlier items wrote', () => {
    const store = createFixtureStore();
    const shadows = [
      { x: 0, y: 1, blur: 2, spread: 0, color: [0, 0, 0, 0.2] as [number, number, number, number] },
    ];
    for (const [command, value] of [
      [setTextStyleCommand, BODY],
      [setEffectStyleCommand, { shadows }],
    ] as const) {
      const outcome = runCommand(
        store,
        ADA,
        batchCommand(command as typeof setTextStyleCommand, 'styles'),
        {
          styles: [
            { name: 'Twin', value },
            { name: 'twin', value },
          ],
        } as never,
        testEnvironment(),
      );
      expect(
        outcome.status === 'rejected'
          ? outcome.errors.map(({ code, path }) => [code, ...path])
          : [],
      ).toEqual([['duplicate-style-name', 'styles', 1, 'name']]);
    }
    expect(store.readTextStyles().size + store.readEffectStyles().size).toBe(0);
    store.destroy();
  });
});
