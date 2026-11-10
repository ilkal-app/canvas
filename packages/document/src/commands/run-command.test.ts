import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { PrincipalId } from '@canvas/schema';

import { ADA, createFixtureStore, id } from '../store/__fixtures__/store-fixtures.js';

import {
  applyCommand,
  expectRejected,
  NOW,
  testEnvironment,
} from './__fixtures__/command-fixtures.js';
import { commandError } from './command-error.js';
import { accept, reject, type Command } from './command.js';
import { moveObjectsCommand } from './move-objects.js';
import { runCommand } from './run-command.js';

/** A command that writes nothing, to see the change set of an empty transaction. */
const noOpCommand: Command<z.ZodObject<{ isValid: z.ZodBoolean }>, null, string> = {
  name: 'noOp',
  description: 'Does nothing.',
  input: z.strictObject({ isValid: z.boolean() }),
  validate(context, input) {
    return input.isValid
      ? accept(null)
      : reject([commandError('missing-object', null, [], 'refused on purpose')]);
  },
  apply() {
    return 'done';
  },
};

describe('runCommand', () => {
  it('applies a valid command as one transaction carrying the origin', () => {
    const store = createFixtureStore();
    let updates = 0;
    store.subscribeUpdates(() => (updates += 1));
    const { result, changes } = applyCommand(store, moveObjectsCommand, {
      moves: [
        { id: 'image-photo', by: { x: 10, y: 0 } },
        { id: 'video-demo', by: { x: 0, y: 10 } },
      ],
    });
    expect(result).toEqual({
      movedIds: ['image-photo', 'video-demo'],
      reparentedIds: [],
      rerootedIds: [],
    });
    expect(updates).toBe(1);
    expect(changes.origin).toEqual(ADA);
    expect(changes.isLocal).toBe(true);
    expect(changes.updated).toEqual(['image-photo', 'video-demo']);
  });

  it('rejects input that fails the input schema without writing, naming the path', () => {
    const store = createFixtureStore();
    const errors = expectRejected(store, moveObjectsCommand, {
      moves: [{ id: 'image-photo', by: { x: 'far' } }],
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((error) => error.code === 'invalid-input')).toBe(true);
    expect(errors[0]?.path[0]).toBe('moves');
  });

  it('rejects unknown keys, so a malformed agent call cannot smuggle fields in', () => {
    const store = createFixtureStore();
    const errors = expectRejected(store, moveObjectsCommand, {
      moves: [{ id: 'image-photo', by: { x: 1, y: 1 } }],
      force: true,
    });
    expect(errors).toEqual([expect.objectContaining({ code: 'invalid-input', path: [] })]);
  });

  it('returns what validate refused, without opening a transaction', () => {
    const store = createFixtureStore();
    expect(expectRejected(store, noOpCommand, { isValid: false })).toEqual([
      expect.objectContaining({ code: 'missing-object', message: 'refused on purpose' }),
    ]);
  });

  it('reports an empty change set when the command wrote nothing', () => {
    const store = createFixtureStore();
    const { result, changes } = applyCommand(store, noOpCommand, { isValid: true });
    expect(result).toBe('done');
    expect(changes).toEqual({ origin: ADA, isLocal: true, created: [], updated: [], deleted: [] });
  });

  it('throws on an invalid origin or a clock that does not tell whole milliseconds', () => {
    const store = createFixtureStore();
    const input = { moves: [{ id: 'image-photo', by: { x: 1, y: 1 } }] };
    const impostor = { kind: 'agent', principalId: 'user:ada' as PrincipalId } as const;
    expect(() => runCommand(store, impostor, moveObjectsCommand, input, testEnvironment())).toThrow(
      RangeError,
    );
    for (const clock of [() => NOW + 0.5, () => -1, () => Number.NaN]) {
      expect(() =>
        runCommand(store, ADA, moveObjectsCommand, input, { ...testEnvironment(), clock }),
      ).toThrow(RangeError);
    }
    expect(store.get(id('image-photo'))).toMatchObject({ x: 900 });
  });

  it('refuses to run inside a store listener, as transactions do not nest', () => {
    const store = createFixtureStore();
    const input = { moves: [{ id: 'image-photo', by: { x: 1, y: 1 } }] };
    let error: unknown;
    const stop = store.subscribe(() => {
      try {
        runCommand(store, ADA, moveObjectsCommand, input, testEnvironment());
      } catch (caught) {
        error = caught;
      }
    });
    applyCommand(store, moveObjectsCommand, { moves: [{ id: 'video-demo', by: { x: 1, y: 1 } }] });
    stop();
    expect(error).toBeInstanceOf(Error);
    expect(store.get(id('image-photo'))).toMatchObject({ x: 900 });
  });
});
