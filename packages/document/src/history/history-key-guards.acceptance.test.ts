// Keyed agent histories protect another key's later writes just as two clients do.
import { describe, expect, it } from 'vitest';

import type { ObjectId, PrincipalId } from '@canvas/schema';

import { applyCommand, mustGet, NOW } from '../commands/__fixtures__/command-fixtures.js';
import { createObjectCommand } from '../commands/create-object.js';
import { moveObjectsCommand } from '../commands/move-objects.js';
import { setStyleCommand } from '../commands/set-style.js';
import { setTextRunsCommand } from '../commands/set-text-runs.js';
import { parseTransactionOrigin } from '../origin/transaction-origin.js';
import { BODY, createFixtureStore } from '../store/__fixtures__/store-fixtures.js';
import type { DocumentStore } from '../store/document-store.js';

import { newShape } from './__fixtures__/creation-fixtures.js';
import { ADA_ID, createClientPair, Link } from './__fixtures__/history-fixtures.js';
import { createHistory } from './undo-manager.js';

const OPERATOR = 'user:ada' as PrincipalId;
const BLUE: [number, number, number, number] = [0, 0, 1, 1];
const RED: [number, number, number, number] = [1, 0, 0, 1];
const GREEN: [number, number, number, number] = [0, 1, 0, 1];
const LATER = { clock: () => NOW + 1_000, createId: () => 'unused' as ObjectId };

function agent(historyKey?: string) {
  return parseTransactionOrigin({
    kind: 'agent',
    principalId: 'agent:scout',
    operatorId: OPERATOR,
    ...(historyKey === undefined ? {} : { historyKey }),
  });
}

function blueShape() {
  const shape = newShape('shape-new');
  if (shape.type !== 'shape') throw new Error('fixture must be a shape');
  return { ...shape, fill: BLUE };
}

function create(store: DocumentStore, historyKey?: string): void {
  applyCommand(store, createObjectCommand, { object: blueShape() }, agent(historyKey));
}

function recolour(
  store: DocumentStore,
  fill: [number, number, number, number],
  historyKey?: string,
  time = NOW + 1_000,
): void {
  applyCommand(
    store,
    setStyleCommand,
    { changes: [{ id: 'shape-new', style: { fill } }] },
    agent(historyKey),
    { ...LATER, clock: () => time },
  );
}

describe('keyed history guards', () => {
  it.each([
    { creator: 'agent-a', writer: 'agent-b', edit: 'recolour' },
    { creator: 'agent-a', writer: undefined, edit: 'move' },
    { creator: undefined, writer: 'agent-a', edit: 'label' },
  ] as const)('uses up $creator creation after $writer $edit', ({ creator, writer, edit }) => {
    const store = createFixtureStore();
    const creatorHistory = createHistory(
      store,
      OPERATOR,
      creator === undefined ? {} : { historyKey: creator },
    );
    const writerHistory = createHistory(
      store,
      OPERATOR,
      writer === undefined ? {} : { historyKey: writer },
    );
    try {
      create(store, creator);
      if (edit === 'recolour') recolour(store, GREEN, writer);
      if (edit === 'move') {
        applyCommand(
          store,
          moveObjectsCommand,
          { moves: [{ id: 'shape-new', by: { x: 25, y: 0 } }] },
          agent(writer),
          LATER,
        );
      }
      if (edit === 'label') {
        applyCommand(
          store,
          setTextRunsCommand,
          { id: 'shape-new', text: 'By A', runs: [{ length: 4, style: BODY }] },
          agent(writer),
          LATER,
        );
      }
      const before = mustGet(store, 'shape-new');
      expect(before).toMatchObject(
        edit === 'recolour'
          ? { fill: GREEN }
          : edit === 'move'
            ? { x: 65 }
            : { label: { text: 'By A' } },
      );
      expect(creatorHistory.undo()).toBe(false);
      expect(mustGet(store, 'shape-new')).toEqual(before);
      expect(creatorHistory.canUndo()).toBe(false);
      expect(creatorHistory.canRedo()).toBe(false);
    } finally {
      creatorHistory.destroy();
      writerHistory.destroy();
      store.destroy();
    }
  });

  it("keeps B's later fill when A undoes its fill", () => {
    const store = createFixtureStore();
    create(store);
    const historyA = createHistory(store, OPERATOR, { historyKey: 'agent-a' });
    const historyB = createHistory(store, OPERATOR, { historyKey: 'agent-b' });
    try {
      recolour(store, RED, 'agent-a');
      recolour(store, GREEN, 'agent-b', NOW + 2_000);
      const afterB = mustGet(store, 'shape-new');
      historyA.undo();
      expect(mustGet(store, 'shape-new')).toEqual(afterB);
    } finally {
      historyA.destroy();
      historyB.destroy();
      store.destroy();
    }
  });

  it('undoes same-key recolour before same-key creation', () => {
    const store = createFixtureStore();
    const historyA = createHistory(store, OPERATOR, { historyKey: 'agent-a' });
    try {
      create(store, 'agent-a');
      recolour(store, GREEN, 'agent-a');
      expect(historyA.undo()).toBe(true);
      expect(mustGet(store, 'shape-new')).toMatchObject({ fill: BLUE });
      expect(historyA.undo()).toBe(true);
      expect(store.get('shape-new' as never)).toBeUndefined();
    } finally {
      historyA.destroy();
      store.destroy();
    }
  });

  it("reverts A's fill when B's write was already in its past", () => {
    const store = createFixtureStore();
    create(store);
    const historyA = createHistory(store, OPERATOR, { historyKey: 'agent-a' });
    const historyB = createHistory(store, OPERATOR, { historyKey: 'agent-b' });
    try {
      recolour(store, GREEN, 'agent-b');
      recolour(store, RED, 'agent-a');
      expect(historyA.undo()).toBe(true);
      expect(mustGet(store, 'shape-new')).toMatchObject({ fill: GREEN });
    } finally {
      historyA.destroy();
      historyB.destroy();
      store.destroy();
    }
  });

  it('matches two clients when a later recolour protects a creation', () => {
    const [ada, bob] = createClientPair(2, 1);
    const link = new Link(ada, bob);
    const history = createHistory(ada, ADA_ID);
    try {
      applyCommand(ada, createObjectCommand, { object: blueShape() });
      link.deliver();
      applyCommand(
        bob,
        setStyleCommand,
        { changes: [{ id: 'shape-new', style: { fill: GREEN } }] },
        agent(),
        LATER,
      );
      link.deliver();
      expect(history.undo()).toBe(false);
      link.deliver();
      expect(mustGet(ada, 'shape-new')).toMatchObject({ fill: GREEN });
      expect(mustGet(bob, 'shape-new')).toMatchObject({ fill: GREEN });
      expect(history.canRedo()).toBe(false);
    } finally {
      history.destroy();
      ada.destroy();
      bob.destroy();
    }
  });

  it('matches two clients when a later recolour protects a field', () => {
    const [ada, bob] = createClientPair(2, 1);
    const link = new Link(ada, bob);
    applyCommand(ada, createObjectCommand, { object: blueShape() });
    link.deliver();
    const history = createHistory(ada, ADA_ID);
    try {
      recolour(ada, RED);
      link.deliver();
      recolour(bob, GREEN, undefined, NOW + 2_000);
      link.deliver();
      const afterBob = mustGet(ada, 'shape-new');
      history.undo();
      link.deliver();
      expect(mustGet(ada, 'shape-new')).toEqual(afterBob);
      expect(mustGet(bob, 'shape-new')).toEqual(afterBob);
    } finally {
      history.destroy();
      ada.destroy();
      bob.destroy();
    }
  });
});
