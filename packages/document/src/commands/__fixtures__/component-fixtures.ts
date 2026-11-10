// Shared by the acceptance tests: the future API is
// reached by name, so these tests compile on a base without components and fail red for a named
// reason (`missing command: <name>`, `missing export: <name>`).
import { expect } from 'vitest';
import type { z } from 'zod';

import * as schema from '@canvas/schema';
import type { BoardObject, ObjectId, PrincipalId } from '@canvas/schema';

import { SCOUT_FOR_ADA, SCOUT_FOR_BOB } from '../../history/__fixtures__/history-fixtures.js';
import type { TransactionOrigin } from '../../origin/transaction-origin.js';
import type { DocumentStore } from '../../store/document-store.js';
import type { CommandError } from '../command-error.js';
import type { AnyCommand, Command } from '../command.js';
import { findCommand } from '../registry.js';
import { runCommand } from '../run-command.js';

import { mustGet, testEnvironment } from './command-fixtures.js';

/** Scout, an agent Ada operates: `kind: 'agent'`, principal `agent:scout`, operator Ada. */
export const AGENT_FOR_ADA: TransactionOrigin = SCOUT_FOR_ADA;

/** Scout operated by Bob instead. */
export const AGENT_FOR_BOB: TransactionOrigin = SCOUT_FOR_BOB;

/** The principal every seeded object is created by when no origin is given. */
export const ADA_PRINCIPAL = 'user:ada' as PrincipalId;

/** When every seeded object was created, ms since the Unix epoch. */
export const SEEDED_AT = 1_760_000_000_000;

/**
 * Finds a command adds, by name, so the test compiles on a base without it.
 *
 * @param name - The command's name in `COMMANDS` (`createComponent`, `createInstance`, ...).
 * @returns The command.
 * @throws {Error} `missing command: <name>` when the registry has no such command.
 */
export function mustFindCommand(name: string): AnyCommand {
  const command = findCommand(name);
  if (command === undefined) throw new Error(`missing command: ${name}`);
  return command;
}

/**
 * Reads an export adds to `@canvas/schema` by name, guarded by `typeof`, so the test
 * compiles on a base without it.
 *
 * @param name - The export's name (`effectiveConstraints`, `resolveInstance`, ...).
 * @returns The export.
 * @throws {Error} `missing export: <name>` when the package has no such export.
 */
export function schemaExport(name: string): unknown {
  const namespace = schema as unknown as Readonly<Record<string, unknown>>;
  const value = namespace[name];
  if (typeof value === 'undefined') throw new Error(`missing export: ${name}`);
  return value;
}

/** A function whose signature the caller narrows with a cast. */
export type UnknownFunction = (...args: never[]) => unknown;

/**
 * Reads a function adds to `@canvas/schema` by name; callers cast it to the contract's
 * signature.
 *
 * @param name - The function's name.
 * @returns The function.
 * @throws {Error} `missing export: <name>` when there is no such function.
 */
export function schemaFunction(name: string): UnknownFunction {
  const value = schemaExport(name);
  if (typeof value !== 'function') throw new Error(`missing export: ${name}`);
  return value as UnknownFunction;
}

/**
 * The instances of a main, through the store's reverse index `BoardReferences.instancesOf`.
 *
 * @param store - The store.
 * @param mainId - The component's id.
 * @returns The instance ids, as the index holds them.
 * @throws {Error} `missing export: BoardReferences.instancesOf` when the index lacks it.
 */
export function instancesOf(store: DocumentStore, mainId: string): ReadonlySet<ObjectId> {
  const references = store.references as unknown as {
    readonly instancesOf?: (id: ObjectId) => ReadonlySet<ObjectId>;
  };
  if (typeof references.instancesOf !== 'function') {
    throw new Error('missing export: BoardReferences.instancesOf');
  }
  return references.instancesOf(mainId as ObjectId);
}

/**
 * Runs a command as some origin and expects it refused with nothing written: the encoded state
 * is byte-identical, no change set or update was delivered, and the snapshot is the same value.
 * `expectRejected` of `command-fixtures.ts` does the same as Ada; this one takes the origin, for
 * the agent refusals (`not-own-main`) and Bob's.
 *
 * @param store - The store.
 * @param origin - Who runs the command.
 * @param command - The command.
 * @param input - Its input.
 * @returns The errors.
 */
export function expectRefusedBy<InputSchema extends z.ZodType, Result>(
  store: DocumentStore,
  origin: TransactionOrigin,
  command: Command<InputSchema, unknown, Result>,
  input: unknown,
): readonly CommandError[] {
  const before = store.encodeState();
  const snapshot = store.read();
  let deliveries = 0;
  const stopChanges = store.subscribe(() => (deliveries += 1));
  const stopUpdates = store.subscribeUpdates(() => (deliveries += 1));
  const outcome = runCommand(
    store,
    origin,
    command,
    input as z.input<InputSchema>,
    testEnvironment(),
  );
  stopChanges();
  stopUpdates();
  expect(outcome.status).toBe('rejected');
  expect(deliveries).toBe(0);
  expect(store.encodeState()).toEqual(before);
  expect(store.read()).toBe(snapshot);
  return outcome.status === 'rejected' ? outcome.errors : [];
}

/**
 * The codes of a refusal, for `toEqual` checks.
 *
 * @param errors - The errors a refusal returned.
 * @returns Their codes, in order.
 */
export function codesOf(errors: readonly CommandError[]): string[] {
  return errors.map((error) => error.code);
}

/**
 * Reads a field of a stored object by name, for the fields the base's `BoardObject` type does
 * not know (`name`, `retired`, `mainId`, `overrides`, `constraints`).
 *
 * @param store - The store.
 * @param objectId - The object.
 * @param field - The field's name.
 * @returns The field's value, `undefined` when the object lacks it.
 * @throws {Error} When there is no such object.
 */
export function fieldOf(store: DocumentStore, objectId: string, field: string): unknown {
  return (mustGet(store, objectId) as unknown as Readonly<Record<string, unknown>>)[field];
}

/**
 * The overrides of a stored instance: one plain record per path.
 *
 * @param store - The store.
 * @param instanceId - The instance.
 * @returns The overrides, by path.
 * @throws {Error} When there is no such object or it has no `overrides` record.
 */
export function overridesOf(
  store: DocumentStore,
  instanceId: string,
): Readonly<Record<string, Readonly<Record<string, unknown>>>> {
  const overrides = fieldOf(store, instanceId, 'overrides');
  if (typeof overrides !== 'object' || overrides === null) {
    throw new Error(`"${instanceId}" has no overrides record`);
  }
  return overrides as Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

/** Where a seeded object sits and how big it is, world units in its parent's frame. */
export interface Box {
  /** Its origin's x. */
  readonly x: number;
  /** Its origin's y. */
  readonly y: number;
  /** Its width. */
  readonly width: number;
  /** Its height. */
  readonly height: number;
}

/**
 * The fields every seeded object shares: Ada's, created at {@link SEEDED_AT}, unrotated,
 * unlocked, key `a0` unless given.
 *
 * @param id - The object's id.
 * @param parentId - Its parent, or `null` for the board root.
 * @param box - Its placement and size.
 * @param z - Its stacking key.
 * @returns The shared fields, as a plain record.
 */
function sharedFields(
  id: string,
  parentId: string | null,
  box: Box,
  z: string,
): Record<string, unknown> {
  return {
    id,
    parentId,
    x: box.x,
    y: box.y,
    rotation: 0,
    z,
    locked: false,
    createdBy: ADA_PRINCIPAL,
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
    width: box.width,
    height: box.height,
  };
}

/**
 * A stored component, as `DocumentTransaction.setObject` would take it once the schema knows the
 * type: a named, sized container at the board root, not retired.
 *
 * @param id - The component's id.
 * @param box - Its placement and size.
 * @param name - Its name.
 * @param z - Its stacking key; `a0` by default.
 * @returns The object, typed as a board object for the store's writes.
 */
export function componentObject(id: string, box: Box, name: string, z = 'a0'): BoardObject {
  return {
    ...sharedFields(id, null, box, z),
    type: 'component',
    name,
    retired: false,
  } as unknown as BoardObject;
}

/**
 * A stored instance, as `DocumentTransaction.setObject` would take it once the schema knows the
 * type: a leaf at the board root naming its main, with its own size and overrides.
 *
 * @param id - The instance's id.
 * @param mainId - The component it instantiates.
 * @param box - Its placement and size.
 * @param overrides - Its overrides by path; none by default.
 * @param z - Its stacking key; `a0` by default.
 * @returns The object, typed as a board object for the store's writes.
 */
export function instanceObject(
  id: string,
  mainId: string,
  box: Box,
  overrides: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {},
  z = 'a0',
): BoardObject {
  return {
    ...sharedFields(id, null, box, z),
    type: 'instance',
    mainId,
    overrides,
  } as unknown as BoardObject;
}
