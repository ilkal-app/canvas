import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import {
  applyCommand,
  mustGet,
  NOW,
  testEnvironment,
} from '../commands/__fixtures__/command-fixtures.js';
import { createObjectCommand } from '../commands/create-object.js';
import { moveObjectsCommand } from '../commands/move-objects.js';
import type { newObjectSchema } from '../commands/new-object-schema.js';
import type { CommandEnvironment } from '../commands/run-command.js';
import { setStyleCommand } from '../commands/set-style.js';
import type { TransactionOrigin } from '../origin/transaction-origin.js';
import {
  ADA,
  BOB,
  BODY,
  createSyncedPair,
  fixtureObject,
  id,
} from '../store/__fixtures__/store-fixtures.js';
import type { ChangeSet, DocumentStore } from '../store/document-store.js';

import { ADA_ID, ADA_UNDO, BOB_ID, Link, SCOUT_FOR_ADA } from './__fixtures__/history-fixtures.js';
import { createHistory } from './undo-manager.js';

// Sync tests for undo: Ada's client and Bob's client each hold a store
// and a history for their user, linked as the relay would link them. Ada's client also runs
// Scout, an agent she operates. Undo must revert only the history's own user's (and her
// agents') changes on every peer, and survive going offline and reconnecting.

const PHOTO = fixtureObject('image-photo', 'image');

/** Bob's clock runs later than Ada's, so his commands rewrite `updatedAt`. */
const BOB_NOW = NOW + 1_000;

/**
 * The command environment of a principal's client: Bob's clock is later than Ada's.
 *
 * @param origin - Who runs the command.
 * @returns The environment.
 */
function environmentOf(origin: TransactionOrigin): CommandEnvironment {
  return origin === BOB ? { clock: () => BOB_NOW, createId: () => id('bob-1') } : testEnvironment();
}

/**
 * Two synced clients holding the fixture board, linked, with a history for each user.
 *
 * @returns Ada's and Bob's stores and histories, and the link between them.
 */
function createClients() {
  const [ada, bob] = createSyncedPair();
  return {
    ada,
    bob,
    link: new Link(ada, bob),
    adaHistory: createHistory(ada, ADA_ID),
    bobHistory: createHistory(bob, BOB_ID),
  };
}

/**
 * Moves the fixture's photo, a root object, by a delta in x.
 *
 * @param store - The store.
 * @param dx - The delta, board units.
 * @param origin - Who moves it.
 */
function movePhoto(store: DocumentStore, dx: number, origin: TransactionOrigin): void {
  const input = { moves: [{ id: 'image-photo', by: { x: dx, y: 0 } }] };
  applyCommand(store, moveObjectsCommand, input, origin, environmentOf(origin));
}

/**
 * Sets the photo's opacity.
 *
 * @param store - The store.
 * @param opacity - The opacity, 0–1.
 * @param origin - Who sets it.
 */
function fadePhoto(store: DocumentStore, opacity: number, origin: TransactionOrigin): void {
  const input = { changes: [{ id: 'image-photo', style: { opacity } }] };
  applyCommand(store, setStyleCommand, input, origin, environmentOf(origin));
}

/**
 * Checks that both peers hold the same board.
 *
 * @param first - One store.
 * @param second - The other.
 */
function expectConverged(first: DocumentStore, second: DocumentStore): void {
  expect(new Map(first.read().objects)).toEqual(new Map(second.read().objects));
}

describe('undo across peers', () => {
  it("lets the operator undo her agent's commands while another user's edit stays", () => {
    const { ada, bob, link, adaHistory } = createClients();
    const sticky: z.input<typeof newObjectSchema> = {
      type: 'sticky',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      text: 'Hi',
      runs: [{ length: 2, style: BODY }],
      align: 'center',
      autoWidth: false,
      verticalAlign: 'middle',
      color: [1, 1, 0, 1],
    };
    const { result } = applyCommand(
      ada,
      createObjectCommand,
      { object: sticky },
      SCOUT_FOR_ADA,
      testEnvironment(11),
    );
    movePhoto(ada, 40, SCOUT_FOR_ADA);
    link.deliver();
    fadePhoto(bob, 0.5, BOB);
    link.deliver();
    expect(adaHistory.undo()).toBe(true);
    expect(adaHistory.undo()).toBe(true);
    link.deliver();
    for (const store of [ada, bob]) {
      expect(store.get(result.id)).toBeUndefined();
      expect(mustGet(store, 'image-photo')).toEqual({ ...PHOTO, opacity: 0.5, updatedAt: BOB_NOW });
    }
    expectConverged(ada, bob);
  });

  it("does not let a user undo another user's change", () => {
    const { ada, bob, link, bobHistory } = createClients();
    movePhoto(ada, 40, ADA);
    link.deliver();
    expect(bobHistory.canUndo()).toBe(false);
    expect(bobHistory.undo()).toBe(false);
    fadePhoto(bob, 0.5, BOB);
    link.deliver();
    bobHistory.undo();
    link.deliver();
    for (const store of [ada, bob]) {
      expect(mustGet(store, 'image-photo')).toMatchObject({
        x: PHOTO.x + 40,
        opacity: PHOTO.opacity,
      });
    }
    expectConverged(ada, bob);
  });

  it("delivers the undo to the other peer with the relay's origin and to the undoer with hers", () => {
    const { ada, bob, link, adaHistory } = createClients();
    movePhoto(ada, 40, ADA);
    link.deliver();
    const seen: ChangeSet[] = [];
    ada.subscribe((changes) => seen.push(changes));
    adaHistory.undo();
    expect(seen.map(({ origin, isLocal }) => ({ origin, isLocal }))).toEqual([
      { origin: ADA_UNDO, isLocal: true },
    ]);
    link.deliver();
    expect(mustGet(bob, 'image-photo')).toEqual(PHOTO);
  });

  it("keeps another user's later edit of the same field: undo never overwrites it", () => {
    const { ada, bob, link, adaHistory } = createClients();
    movePhoto(ada, 40, ADA);
    link.deliver();
    movePhoto(bob, 100, BOB);
    link.deliver();
    // Every field Ada's move wrote (x, updatedAt) has since been overwritten by Bob.
    expect(adaHistory.undo()).toBe(false);
    expect(adaHistory.canUndo()).toBe(false);
    link.deliver();
    expect(mustGet(ada, 'image-photo')).toMatchObject({ x: PHOTO.x + 140, updatedAt: BOB_NOW });
    expectConverged(ada, bob);
  });
});

describe('redo across peers', () => {
  it('redoes after another user edited another field meanwhile, keeping that edit', () => {
    const { ada, bob, link, adaHistory } = createClients();
    movePhoto(ada, 40, ADA);
    adaHistory.undo();
    link.deliver();
    fadePhoto(bob, 0.5, BOB);
    link.deliver();
    expect(adaHistory.redo()).toBe(true);
    link.deliver();
    for (const store of [ada, bob]) {
      expect(mustGet(store, 'image-photo')).toMatchObject({ x: PHOTO.x + 40, opacity: 0.5 });
    }
    expectConverged(ada, bob);
  });
});

describe('undo survives reconnection', () => {
  it('converges with the undo applied when the undo was made offline', () => {
    const { ada, bob, link, adaHistory } = createClients();
    movePhoto(ada, 40, ADA);
    link.deliver();
    link.disconnect();
    adaHistory.undo();
    fadePhoto(bob, 0.5, BOB);
    applyCommand(
      bob,
      moveObjectsCommand,
      { moves: [{ id: 'line-divider', to: { x: 0, y: 0 } }] },
      BOB,
    );
    expect(link.pendingCount).toBe(3);
    expect(mustGet(bob, 'image-photo').x).toBe(PHOTO.x + 40);
    link.reconnect();
    for (const store of [ada, bob]) {
      expect(mustGet(store, 'image-photo')).toMatchObject({ x: PHOTO.x, opacity: 0.5 });
      expect(mustGet(store, 'line-divider')).toMatchObject({ x: 0, y: 0 });
    }
    expectConverged(ada, bob);
  });

  it("undoes an offline change after reconnecting, keeping a concurrent remote edit's other field", () => {
    const { ada, bob, link, adaHistory } = createClients();
    link.disconnect();
    movePhoto(ada, 40, ADA);
    fadePhoto(bob, 0.5, BOB);
    link.reconnect();
    adaHistory.undo();
    link.deliver();
    for (const store of [ada, bob]) {
      expect(mustGet(store, 'image-photo')).toMatchObject({ x: PHOTO.x, opacity: 0.5 });
    }
    expectConverged(ada, bob);
  });

  it('redoes after reconnecting, and the redo reaches the other peer', () => {
    const { ada, bob, link, adaHistory } = createClients();
    movePhoto(ada, 40, ADA);
    link.disconnect();
    adaHistory.undo();
    link.reconnect();
    expect(mustGet(bob, 'image-photo')).toEqual(PHOTO);
    link.disconnect();
    adaHistory.redo();
    link.reconnect();
    expect(mustGet(bob, 'image-photo')).toEqual({ ...PHOTO, x: PHOTO.x + 40, updatedAt: NOW });
    expectConverged(ada, bob);
  });
});

describe('undo and concurrent formatted text', () => {
  it('converges after undoing a restyle that raced a remote restyle of the same text', () => {
    const { ada, bob, link, adaHistory } = createClients();
    const restyle = (store: DocumentStore, style: object, origin: TransactionOrigin) =>
      applyCommand(
        store,
        setStyleCommand,
        { changes: [{ id: 'sticky-idea', style: { textStyle: style } }] },
        origin,
      );
    link.disconnect();
    restyle(ada, { weight: 700 }, ADA);
    restyle(bob, { italic: true }, BOB);
    link.reconnect();
    adaHistory.undo();
    link.deliver();
    expect(mustGet(ada, 'sticky-idea')).toMatchObject({
      runs: [{ length: 16, style: { ...BODY, italic: true } }],
    });
    expectConverged(ada, bob);
  });
});
