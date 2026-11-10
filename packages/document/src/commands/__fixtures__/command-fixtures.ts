import { expect } from 'vitest';
import type { z } from 'zod';

import { createSeededIdGenerator, type BoardObject, type ObjectId } from '@canvas/schema';

import type { TransactionOrigin } from '../../origin/transaction-origin.js';
import { ADA } from '../../store/__fixtures__/store-fixtures.js';
import type { BoardSnapshot, ChangeSet, DocumentStore } from '../../store/document-store.js';
import type { CommandError } from '../command-error.js';
import type { Command } from '../command.js';
import { runCommand, type CommandEnvironment } from '../run-command.js';

/** The frozen time every command in these tests runs at. */
export const NOW = 1_770_000_000_000;

/**
 * A deterministic environment: the frozen clock and seeded ids.
 *
 * @param seed - The id generator's seed; give each simulated client its own.
 * @returns The environment.
 */
export function testEnvironment(seed = 7): CommandEnvironment {
  return { clock: () => NOW, createId: createSeededIdGenerator(seed) };
}

/** A command as these helpers take it. */
type AnyTestCommand<InputSchema extends z.ZodType, Result> = Command<InputSchema, unknown, Result>;

/**
 * Runs a command that must be applied, returning its result and change set.
 *
 * @param store - The store.
 * @param command - The command.
 * @param input - Its input.
 * @param origin - The origin; Ada by default.
 * @param environment - The environment; seed 7 by default.
 * @returns The result and the change set.
 * @throws {Error} When the command is rejected.
 */
export function applyCommand<InputSchema extends z.ZodType, Result>(
  store: DocumentStore,
  command: AnyTestCommand<InputSchema, Result>,
  input: z.input<InputSchema>,
  origin: TransactionOrigin = ADA,
  environment: CommandEnvironment = testEnvironment(),
): { readonly result: Result; readonly changes: ChangeSet } {
  const outcome = runCommand(store, origin, command, input, environment);
  if (outcome.status === 'rejected') {
    throw new Error(`expected the command to apply: ${JSON.stringify(outcome.errors)}`);
  }
  return outcome;
}

/**
 * Runs a command that must be rejected, and checks it wrote nothing: the encoded state is
 * byte-identical, and no change set or update was delivered.
 *
 * @param store - The store.
 * @param command - The command.
 * @param input - Its input, possibly malformed.
 * @returns The errors.
 */
export function expectRejected<InputSchema extends z.ZodType, Result>(
  store: DocumentStore,
  command: AnyTestCommand<InputSchema, Result>,
  input: unknown,
): readonly CommandError[] {
  const before = store.encodeState();
  const snapshot = store.read();
  let deliveries = 0;
  const stopChanges = store.subscribe(() => (deliveries += 1));
  const stopUpdates = store.subscribeUpdates(() => (deliveries += 1));
  const outcome = runCommand(store, ADA, command, input as z.input<InputSchema>, testEnvironment());
  stopChanges();
  stopUpdates();
  expect(outcome.status).toBe('rejected');
  expect(deliveries).toBe(0);
  expect(store.encodeState()).toEqual(before);
  expect(store.read()).toBe(snapshot);
  return outcome.status === 'rejected' ? outcome.errors : [];
}

/** Which objects differ between two snapshots, by identity (unchanged objects are shared). */
export interface SnapshotDiff {
  /** Ids only in the later snapshot. */
  readonly created: readonly ObjectId[];
  /** Ids in both whose object is not the same value. */
  readonly updated: readonly ObjectId[];
  /** Ids only in the earlier snapshot. */
  readonly deleted: readonly ObjectId[];
}

/**
 * Diffs two snapshots of one store by object identity, sorted like a change set.
 *
 * @param before - The earlier snapshot.
 * @param after - The later snapshot.
 * @returns The ids created, updated and deleted.
 */
export function diffSnapshots(before: BoardSnapshot, after: BoardSnapshot): SnapshotDiff {
  const created = [...after.objects.keys()].filter((key) => !before.objects.has(key));
  const deleted = [...before.objects.keys()].filter((key) => !after.objects.has(key));
  const updated = [...after.objects.entries()]
    .filter(([key, object]) => before.objects.has(key) && before.objects.get(key) !== object)
    .map(([key]) => key);
  return { created: created.sort(), updated: updated.sort(), deleted: deleted.sort() };
}

/**
 * Checks a command's document diff: the snapshot diff equals the change set exactly, and
 * equals the expected ids.
 *
 * @param before - The snapshot before the command.
 * @param after - The snapshot after it.
 * @param changes - The command's change set.
 * @param expected - The ids expected in each list; omitted lists are expected empty.
 */
export function expectDiff(
  before: BoardSnapshot,
  after: BoardSnapshot,
  changes: ChangeSet,
  expected: Partial<Record<keyof SnapshotDiff, readonly string[]>>,
): void {
  const diff = diffSnapshots(before, after);
  const want = {
    created: [...(expected.created ?? [])].sort(),
    updated: [...(expected.updated ?? [])].sort(),
    deleted: [...(expected.deleted ?? [])].sort(),
  };
  expect(diff).toEqual(want);
  expect({ created: changes.created, updated: changes.updated, deleted: changes.deleted }).toEqual(
    want,
  );
}

/**
 * Reads an object that must exist.
 *
 * @param store - The store.
 * @param objectId - The object id.
 * @returns The object.
 * @throws {Error} When there is no such object.
 */
export function mustGet(store: DocumentStore, objectId: string): BoardObject {
  const object = store.get(objectId as ObjectId);
  if (object === undefined) throw new Error(`no object "${objectId}"`);
  return object;
}
