import { expect } from 'vitest';
import type { z } from 'zod';

import { validateBoard, type ObjectId } from '@canvas/schema';

import {
  applyCommand,
  mustGet,
  NOW,
  testEnvironment,
} from '../../commands/__fixtures__/command-fixtures.js';
import { createObjectCommand } from '../../commands/create-object.js';
import { deleteObjectsCommand } from '../../commands/delete-objects.js';
import { moveObjectsCommand } from '../../commands/move-objects.js';
import type { newObjectSchema } from '../../commands/new-object-schema.js';
import type { CommandEnvironment } from '../../commands/run-command.js';
import { setStyleCommand } from '../../commands/set-style.js';
import { setTextRunsCommand } from '../../commands/set-text-runs.js';
import type { TransactionOrigin } from '../../origin/transaction-origin.js';
import {
  ADA,
  BOB,
  BODY,
  RELAY,
  unreadableEntries,
} from '../../store/__fixtures__/store-fixtures.js';
import type { DocumentStore } from '../../store/document-store.js';
import type { YjsDocumentStore } from '../../store/yjs-document-store.js';
import { createHistory, type UndoHistory } from '../undo-manager.js';

import { ADA_ID, createClientPair, Link } from './history-fixtures.js';

// Shared by the creation guard's sync tests: Ada creates objects, Bob (another client)
// or the product writes to them or refers to them, and Ada undoes the creation.

/** An object as `createObject` takes it. */
export type NewObject = z.input<typeof newObjectSchema>;

/**
 * Both merge orders: when two clients write one key at once, the higher Yjs client id wins, so
 * every case runs with Ada's id above and below Bob's.
 */
export const ORDERS = [
  { name: "Ada's writes win", adaClientId: 2, bobClientId: 1 },
  { name: "Bob's writes win", adaClientId: 1, bobClientId: 2 },
] as const;

/**
 * Bob's command environment: his own seeded ids, and a clock a second after Ada's. A command
 * stamps `updatedAt` only when the time differs from the object's (`StampingTransaction`), and
 * the creation guard tells a person's write of a reference key from the repair's by that stamp
 * (`written-by-others.ts`), so Bob's edits of Ada's objects must carry a later time, as they do
 * outside tests.
 */
export const BOB_ENVIRONMENT: CommandEnvironment = {
  clock: () => NOW + 1_000,
  createId: testEnvironment(23).createId,
};

/**
 * A root rectangle without a label.
 *
 * @param objectId - Its id.
 * @param parentId - Its parent; the root by default.
 * @returns The object, as `createObject` takes it.
 */
export function newShape(objectId: string, parentId: string | null = null): NewObject {
  return {
    type: 'shape',
    id: objectId,
    parentId,
    x: 40,
    y: 10,
    rotation: 0,
    width: 100,
    height: 60,
    kind: 'rectangle',
    cornerRadius: 0,
    sides: 4,
    fill: [1, 0, 0, 1],
    stroke: null,
    label: null,
  };
}

/** A failed link card, which only `retryLinkUnfurl` takes. */
export const FAILED_LINK_CARD: NewObject = {
  type: 'link',
  id: 'link-failed',
  parentId: null,
  x: 0,
  y: 0,
  rotation: 0,
  width: 320,
  height: 72,
  url: 'https://example.com/gone',
  title: '',
  description: '',
  siteName: '',
  layout: 'vertical',
  status: 'failed',
  unfurlKey: 'paste-gone',
};

/** A root text object Ada creates. */
export const NEW_TEXT: NewObject = {
  type: 'text',
  id: 'text-new',
  x: 0,
  y: 900,
  width: 200,
  height: 40,
  text: 'Ada',
  runs: [{ length: 3, style: BODY }],
  align: 'left',
  autoWidth: true,
  verticalAlign: 'top',
};

/** A root frame Ada creates, clear of the fixture board. */
export const NEW_FRAME: NewObject = {
  type: 'frame',
  id: 'frame-new',
  x: 2_000,
  y: 0,
  width: 800,
  height: 600,
  name: 'New frame',
  clip: true,
  background: [1, 1, 1, 1],
};

/** Two linked clients and Ada's history. */
export interface Clients {
  readonly ada: YjsDocumentStore;
  readonly bob: YjsDocumentStore;
  readonly link: Link;
  readonly history: UndoHistory;
}

/**
 * Two linked clients holding the fixture board, with Ada's history.
 *
 * @param adaClientId - Ada's Yjs client id.
 * @param bobClientId - Bob's Yjs client id.
 * @returns The clients.
 */
export function createClients(adaClientId: number, bobClientId: number): Clients {
  const [ada, bob] = createClientPair(adaClientId, bobClientId);
  return { ada, bob, link: new Link(ada, bob), history: createHistory(ada, ADA_ID) };
}

/**
 * Creates an object, as Ada by default.
 *
 * @param store - The store.
 * @param object - The object.
 * @param origin - Who creates it.
 * @returns The new object's id.
 */
export function create(
  store: DocumentStore,
  object: NewObject,
  origin: TransactionOrigin = ADA,
): ObjectId {
  const environment = origin === BOB ? BOB_ENVIRONMENT : testEnvironment();
  return applyCommand(store, createObjectCommand, { object }, origin, environment).result.id;
}

/**
 * Sets an object's fill, as Bob by default.
 *
 * @param store - The store.
 * @param objectId - The object.
 * @param fill - The new fill.
 * @param origin - Who restyles it.
 */
export function refill(
  store: DocumentStore,
  objectId: string,
  fill: [number, number, number, number],
  origin: TransactionOrigin = BOB,
): void {
  const changes = [{ id: objectId, style: { fill } }];
  applyCommand(store, setStyleCommand, { changes }, origin, BOB_ENVIRONMENT);
}

/**
 * Moves an object, optionally into another frame, as Bob by default.
 *
 * @param store - The store.
 * @param objectId - The object.
 * @param dx - The displacement in x, board units.
 * @param parentId - The frame it ends up in; omitted keeps its parent.
 * @param origin - Who moves it.
 */
export function moveBy(
  store: DocumentStore,
  objectId: string,
  dx: number,
  parentId?: string | null,
  origin: TransactionOrigin = BOB,
): void {
  const move = {
    id: objectId,
    by: { x: dx, y: 0 },
    ...(parentId === undefined ? {} : { parentId }),
  };
  const environment = origin === BOB ? BOB_ENVIRONMENT : testEnvironment();
  applyCommand(store, moveObjectsCommand, { moves: [move] }, origin, environment);
}

/**
 * Deletes objects, as Ada by default.
 *
 * @param store - The store.
 * @param ids - The objects.
 * @param origin - Who deletes them.
 */
export function remove(
  store: DocumentStore,
  ids: readonly string[],
  origin: TransactionOrigin = ADA,
): void {
  const environment = origin === BOB ? BOB_ENVIRONMENT : testEnvironment();
  applyCommand(store, deleteObjectsCommand, { ids: [...ids] }, origin, environment);
}

/**
 * Sends one store what another lacks, one way, as the relay would in one diff.
 *
 * @param from - The store that has the updates.
 * @param to - The store that receives them.
 */
export function sendAll(from: DocumentStore, to: DocumentStore): void {
  to.applyUpdate(from.encodeState(to.encodeStateVector()), RELAY);
}

/**
 * Sets the text of a text object, or of a shape's label, as Bob.
 *
 * @param store - The store.
 * @param objectId - The object.
 * @param text - The new text.
 */
export function type(store: DocumentStore, objectId: string, text: string): void {
  const input = { id: objectId, text, runs: [{ length: text.length, style: BODY }] };
  applyCommand(store, setTextRunsCommand, input, BOB, BOB_ENVIRONMENT);
}

/**
 * Checks both peers hold the same readable board, which keeps the board rules.
 *
 * @param first - One store.
 * @param second - The other.
 */
export function expectConvergedValidBoards(first: DocumentStore, second: DocumentStore): void {
  expect(unreadableEntries(first)).toEqual([]);
  expect(unreadableEntries(second)).toEqual([]);
  expect(new Map(first.read().objects)).toEqual(new Map(second.read().objects));
  expect(validateBoard(first.read())).toEqual([]);
}

/**
 * Checks an undo was used up with nothing changed: it returned `false`, the object is on both
 * boards as it was before the undo, and no step was left to redo.
 *
 * @param clients - The clients.
 * @param objectId - The object whose creation was undone.
 */
export function expectUsedUpKeeping(clients: Clients, objectId: string): void {
  const { ada, bob, link, history } = clients;
  const before = mustGet(ada, objectId);
  expect(history.undo()).toBe(false);
  link.deliver();
  expect(mustGet(ada, objectId)).toEqual(before);
  expect(mustGet(bob, objectId)).toEqual(before);
  expect(history.canRedo()).toBe(false);
  expectConvergedValidBoards(ada, bob);
}
