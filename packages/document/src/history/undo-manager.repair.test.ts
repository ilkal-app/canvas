import { describe, expect, it } from 'vitest';

import {
  detachCommentsFrom,
  detachConnectorsFrom,
  objectToBoardTransform,
  validateBoard,
  type Board,
  type ObjectId,
} from '@canvas/schema';

import {
  applyCommand,
  mustGet,
  NOW,
  testEnvironment,
} from '../commands/__fixtures__/command-fixtures.js';
import { createObjectsCommand } from '../commands/create-objects.js';
import { deleteObjectsCommand } from '../commands/delete-objects.js';
import { setLockedCommand } from '../commands/set-locked.js';
import { setStyleCommand } from '../commands/set-style.js';
import { writeKeysRemotely } from '../store/__fixtures__/remote-keys.js';
import { BOB, BODY, id, RELAY, unreadableEntries } from '../store/__fixtures__/store-fixtures.js';
import type { DocumentStore } from '../store/document-store.js';

import type { NewObject } from './__fixtures__/creation-fixtures.js';
import { ADA_ID, createClientPair, Link } from './__fixtures__/history-fixtures.js';
import { createHistory } from './undo-manager.js';

// Undo reverts Yjs items, not commands, so it can remove an object something else still refers
// to, or restore one whose target is gone. The history repairs those references in the undo's
// own transaction, with the rules a delete uses (reference-repair.ts), so the board stays valid.
// Since an undo keeps an object another user touched or referred to since the step
// (`creation-guard.ts`), so the cases here start from one step that creates both the target and
// what refers to it (a paste): another user edits what refers, and the undo removes the target.

const ORDERS = [
  { name: "Ada's client id above Bob's", adaClientId: 2, bobClientId: 1 },
  { name: "Ada's client id below Bob's", adaClientId: 1, bobClientId: 2 },
] as const;

/** Bob's command environment: his own seeded ids. */
const BOB_ENVIRONMENT = { clock: () => NOW + 1_000, createId: testEnvironment(23).createId };

/**
 * Checks both peers hold the same board and that the schema finds nothing wrong with it.
 *
 * @param first - One store.
 * @param second - The other.
 */
function expectValidAndConverged(first: DocumentStore, second: DocumentStore): void {
  expect(validateBoard(first.read())).toEqual([]);
  expect(unreadableEntries(first)).toEqual([]);
  expect(new Map(first.read().objects)).toEqual(new Map(second.read().objects));
}

/**
 * The linked clients, with Ada's history.
 *
 * @param adaClientId - Ada's Yjs client id.
 * @param bobClientId - Bob's Yjs client id.
 * @returns The stores, the link and Ada's history.
 */
function createClients(adaClientId: number, bobClientId: number) {
  const [ada, bob] = createClientPair(adaClientId, bobClientId);
  return { ada, bob, link: new Link(ada, bob), history: createHistory(ada, ADA_ID) };
}

/** A rectangle as `createObjects` takes it. */
const SHAPE = {
  type: 'shape',
  id: 'shape',
  x: 40,
  y: 10,
  rotation: 0.25,
  width: 100,
  height: 60,
  kind: 'rectangle',
  cornerRadius: 0,
  sides: 4,
  fill: [1, 0, 0, 1],
  stroke: null,
  label: null,
} satisfies NewObject;

/** A connector between two points, as `createObjects` takes it. */
const WIRE = {
  type: 'connector',
  id: 'wire',
  x: 0,
  y: 0,
  from: { kind: 'point', x: 0, y: 0 },
  to: { kind: 'point', x: 900, y: 900 },
  route: 'straight',
  stroke: { color: [0, 0, 0, 1], width: 2 },
  startCap: 'none',
  endCap: 'arrow',
  label: null,
} satisfies NewObject;

/**
 * Ada pastes a sticky with a connector attached to it and a comment pinned on it, in one step.
 *
 * @param store - Ada's store.
 * @returns The new ids of the sticky, the connector and the comment.
 */
function pasteNote(store: DocumentStore): { note: ObjectId; wire: ObjectId; pin: ObjectId } {
  const objects: NewObject[] = [
    {
      type: 'sticky',
      id: 'note',
      x: 500,
      y: 500,
      width: 100,
      height: 100,
      text: 'Hi',
      runs: [{ length: 2, style: BODY }],
      align: 'center',
      autoWidth: false,
      verticalAlign: 'middle',
      color: [1, 1, 0, 1],
    },
    {
      type: 'connector',
      id: 'wire',
      x: 0,
      y: 0,
      from: { kind: 'object', objectId: 'note', anchor: { x: 1, y: 0.5 } },
      to: { kind: 'point', x: 900, y: 900 },
      route: 'straight',
      stroke: { color: [0, 0, 0, 1], width: 2 },
      startCap: 'none',
      endCap: 'arrow',
      label: null,
    },
    {
      type: 'comment',
      id: 'pin',
      x: 0,
      y: 0,
      threadId: 'thread-new',
      anchor: { kind: 'object', objectId: 'note', offset: { x: 10, y: 20 } },
    },
  ];
  const { ids } = applyCommand(store, createObjectsCommand, { objects }).result;
  const [note, wire, pin] = ids as [ObjectId, ObjectId, ObjectId];
  return { note, wire, pin };
}

/**
 * Bob restyles a connector: his edit keeps it through Ada's undo.
 *
 * @param store - Bob's store.
 * @param connectorId - The connector.
 */
function thicken(store: DocumentStore, connectorId: ObjectId): void {
  const color: [number, number, number, number] = [0, 0, 1, 1];
  const changes = [{ id: connectorId, style: { stroke: { color, width: 6 } } }];
  applyCommand(store, setStyleCommand, { changes }, BOB, BOB_ENVIRONMENT);
}

/**
 * A copy of a store's board, for measuring positions before an undo.
 *
 * @param store - The store.
 * @returns The board.
 */
function boardOf(store: DocumentStore): Board {
  return { objects: new Map(store.read().objects) };
}

describe('undo repair past an object whose stored z is not a key', () => {
  it('detaches the connector, reverts cleanly and can redo (fix round 1)', () => {
    const { ada, bob, link, history } = createClients(1, 2);
    const { note, wire } = pasteNote(ada);
    link.deliver();
    thicken(bob, wire); // Bob's edit keeps the connector through Ada's undo
    link.deliver();
    // A peer that skips validation gives the connector a key the schema rejects. The link
    // relays only local updates, so Ada catches up from Bob directly.
    writeKeysRemotely(bob, { [wire]: 'legacy' });
    ada.applyUpdate(bob.encodeState(ada.encodeStateVector()), RELAY);
    expect(mustGet(ada, wire).z).toBe('legacy');
    expect(history.undo()).toBe(true);
    link.deliver();
    expect(mustGet(ada, wire)).toMatchObject({ z: 'legacy', from: { kind: 'point' } });
    expect(ada.get(note)).toBeUndefined();
    expect(history.canRedo()).toBe(true);
    expectValidAndConverged(ada, bob);
  });
});

describe.each(ORDERS)('undo repairs references ($name)', ({ adaClientId, bobClientId }) => {
  it('detaches, where it was, a connector another user edited from an object the undo removes', () => {
    const { ada, bob, link, history } = createClients(adaClientId, bobClientId);
    const { note, wire } = pasteNote(ada);
    link.deliver();
    thicken(bob, wire);
    link.deliver();
    const before = boardOf(ada);
    expect(history.undo()).toBe(true);
    link.deliver();
    const expected = detachConnectorsFrom(before, [note]).objects.get(wire);
    expect(mustGet(ada, wire)).toEqual(expected);
    expect(mustGet(ada, wire)).toMatchObject({ from: { kind: 'point' } });
    expect(ada.get(note)).toBeUndefined();
    expectValidAndConverged(ada, bob);
  });

  // A kept object's parent is kept too, so a re-rooted child comes from an undo that restores
  // an object whose parent another user deleted since.
  it('moves a member the undo restores out of a group another user deleted, in place', () => {
    const { ada, bob, link, history } = createClients(adaClientId, bobClientId);
    const objects: NewObject[] = [
      { type: 'group', id: 'g', x: 300, y: 200, rotation: 0.5 },
      { ...SHAPE, id: 'inside', parentId: 'g' },
      { ...SHAPE, id: 'other', parentId: 'g', x: 300 },
    ];
    const { ids } = applyCommand(ada, createObjectsCommand, { objects }).result;
    const [group, inside] = ids as [ObjectId, ObjectId];
    link.deliver();
    const placed = objectToBoardTransform(boardOf(ada), mustGet(ada, inside));
    applyCommand(ada, deleteObjectsCommand, { ids: [inside] });
    link.deliver();
    applyCommand(bob, deleteObjectsCommand, { ids: [group] }, BOB, BOB_ENVIRONMENT);
    link.deliver();
    expect(history.undo()).toBe(true);
    link.deliver();
    expect(ada.get(group)).toBeUndefined();
    const moved = mustGet(ada, inside);
    expect(moved.parentId).toBeNull();
    const now = objectToBoardTransform(boardOf(ada), moved);
    for (const key of ['cos', 'sin', 'x', 'y'] as const)
      expect(now[key]).toBeCloseTo(placed[key], 9);
    expectValidAndConverged(ada, bob);
  });

  // Review M1: a connector detached from a removed group, measured from the group's members.
  it('detaches, where it was, a connector another user edited from a group the undo removes', () => {
    const { ada, bob, link, history } = createClients(adaClientId, bobClientId);
    const objects: NewObject[] = [
      { type: 'group', id: 'g', x: 300, y: 200, rotation: 0.5 },
      { ...SHAPE, id: 'a', parentId: 'g' },
      { ...SHAPE, id: 'b', parentId: 'g', x: 200 },
      { ...WIRE, from: { kind: 'object', objectId: 'g', anchor: { x: 1, y: 0.5 } } },
    ];
    const { ids } = applyCommand(ada, createObjectsCommand, { objects }).result;
    const [group, , , wire] = ids as [ObjectId, ObjectId, ObjectId, ObjectId];
    link.deliver();
    thicken(bob, wire);
    link.deliver();
    const before = boardOf(ada);
    expect(history.undo()).toBe(true);
    link.deliver();
    for (const pasted of ids.slice(0, 3)) expect(ada.get(pasted)).toBeUndefined();
    expect(mustGet(ada, wire)).toEqual(detachConnectorsFrom(before, [group]).objects.get(wire));
    expect(mustGet(ada, wire)).toMatchObject({ from: { kind: 'point' } });
    expectValidAndConverged(ada, bob);
  });

  it('turns a comment another user locked into a point pin where it was, when its object goes', () => {
    const { ada, bob, link, history } = createClients(adaClientId, bobClientId);
    const { note, pin } = pasteNote(ada);
    link.deliver();
    applyCommand(bob, setLockedCommand, { ids: [pin], locked: true }, BOB, BOB_ENVIRONMENT);
    link.deliver();
    const expected = detachCommentsFrom(boardOf(ada), [note]).objects.get(pin);
    expect(history.undo()).toBe(true);
    link.deliver();
    expect(mustGet(ada, pin)).toEqual(expected);
    expect(mustGet(ada, pin)).toMatchObject({ anchor: { kind: 'point' }, locked: true });
    expectValidAndConverged(ada, bob);
  });

  it('detaches an end of an object the undo restores whose target another user deleted', () => {
    const { ada, bob, link, history } = createClients(adaClientId, bobClientId);
    const where = detachConnectorsFrom(boardOf(ada), [id('sticky-idea')]).objects.get(
      id('connector-flow'),
    );
    applyCommand(ada, deleteObjectsCommand, { ids: ['connector-flow'] });
    link.deliver();
    applyCommand(bob, deleteObjectsCommand, { ids: ['sticky-idea'] }, BOB, BOB_ENVIRONMENT);
    link.deliver();
    history.undo();
    link.deliver();
    // Where the target was last seen, not the connector's origin.
    expect(where?.type === 'connector' ? where.from : undefined).toMatchObject({ kind: 'point' });
    expect(mustGet(ada, 'connector-flow')).toMatchObject({
      from: where?.type === 'connector' ? where.from : undefined,
      to: { kind: 'object', objectId: 'shape-box' },
    });
    expectValidAndConverged(ada, bob);
  });
});

describe('undo reference repair, then redo', () => {
  it('redo brings the object back and attaches the repaired connector to it again', () => {
    const { ada, bob, link, history } = createClients(2, 1);
    const { wire } = pasteNote(ada);
    link.deliver();
    thicken(bob, wire);
    link.deliver();
    const attached = mustGet(ada, wire);
    history.undo();
    link.deliver();
    expect(history.redo()).toBe(true);
    link.deliver();
    expect(mustGet(ada, wire)).toEqual(attached);
    expectValidAndConverged(ada, bob);
  });
});

describe('undo reference repair, reported', () => {
  it('lists the repaired objects in the undo change set', () => {
    const { ada, bob, link, history } = createClients(2, 1);
    const { wire } = pasteNote(ada);
    link.deliver();
    thicken(bob, wire);
    link.deliver();
    const updated: ObjectId[][] = [];
    ada.subscribe((changes) => updated.push([...changes.updated]));
    history.undo();
    expect(updated[0]).toContain(wire);
  });
});
