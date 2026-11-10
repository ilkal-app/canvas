import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { createHistory } from '../history/undo-manager.js';
import {
  ADA,
  BOB,
  createFixtureStore,
  createSyncedPair,
  exchange,
  fixtureObject,
  id,
} from '../store/__fixtures__/store-fixtures.js';
import type { DocumentStore } from '../store/document-store.js';

import {
  applyCommand,
  expectDiff,
  expectRejected,
  mustGet,
} from './__fixtures__/command-fixtures.js';
import { refusalsOn, storedBoardOf } from './__fixtures__/stored-board.js';
import { connectCommand } from './connect.js';
import { moveObjectsCommand } from './move-objects.js';
import type { setConnectorEndInputSchema } from './set-connector-end.js';
import { setConnectorEndCommand } from './set-connector-end.js';
import { setLockedCommand } from './set-locked.js';
import { setStyleCommand } from './set-style.js';

// On the fixture board, `connector-flow` runs at the root, unturned at the origin, from
// `sticky-idea` (anchor: its right edge's middle) to `shape-box` (automatic).

/**
 * A connector's two ends.
 *
 * @param store - The store.
 * @param connectorId - The connector.
 * @returns Its `from` and `to`.
 * @throws {Error} When the object is not a connector.
 */
function endsOf(store: DocumentStore, connectorId = 'connector-flow') {
  const object = mustGet(store, connectorId);
  if (object.type !== 'connector') throw new Error(`"${connectorId}" is not a connector`);
  return { from: object.from, to: object.to };
}

describe('setConnectorEnd', () => {
  it('attaches an end to another object, at an anchor or automatically, writing it alone', () => {
    const store = createFixtureStore();
    const before = store.read();
    const { result, changes } = applyCommand(store, setConnectorEndCommand, {
      id: 'connector-flow',
      end: 'to',
      target: { objectId: 'image-photo', anchor: { x: 0, y: 0.5 } },
    });
    expect(result).toEqual({ changedIds: ['connector-flow'] });
    expectDiff(before, store.read(), changes, { updated: ['connector-flow'] });
    expect(endsOf(store)).toEqual({
      from: { kind: 'object', objectId: 'sticky-idea', anchor: { x: 1, y: 0.5 } },
      to: { kind: 'object', objectId: 'image-photo', anchor: { x: 0, y: 0.5 } },
    });
    expect(store.references.connectorsAttachedTo(mustGet(store, 'image-photo').id).size).toBe(1);
    applyCommand(store, setConnectorEndCommand, {
      id: 'connector-flow',
      end: 'from',
      target: { objectId: 'sticky-idea' },
    });
    expect(endsOf(store).from).toEqual({ kind: 'object', objectId: 'sticky-idea', anchor: null });
  });

  it('frees an end at a board point, stored in the connector’s own frame', () => {
    const store = createFixtureStore();
    // A connector inside the frame, whose origin is at (-400, -300) on the board.
    applyCommand(store, connectCommand, {
      id: 'wire',
      parentId: 'frame-plan',
      from: { objectId: 'text-title' },
      to: { objectId: 'sticky-idea' },
    });
    applyCommand(store, setConnectorEndCommand, {
      id: 'wire',
      end: 'to',
      target: { point: { x: 100, y: 50 } },
    });
    expect(endsOf(store, 'wire').to).toEqual({ kind: 'point', x: 500, y: 350 });
  });

  it('writes nothing for an end that is already so', () => {
    const store = createFixtureStore();
    const before = store.encodeState();
    const same = [
      { objectId: 'sticky-idea', anchor: { x: 1, y: 0.5 } },
      { objectId: 'shape-box', anchor: null },
    ] as const;
    expect(
      applyCommand(store, setConnectorEndCommand, {
        id: 'connector-flow',
        end: 'from',
        target: same[0],
      }).result,
    ).toEqual({ changedIds: [] });
    applyCommand(store, setConnectorEndCommand, {
      id: 'connector-flow',
      end: 'to',
      target: same[1],
    });
    expect(store.encodeState()).toEqual(before);
    applyCommand(store, setConnectorEndCommand, {
      id: 'connector-flow',
      end: 'to',
      target: { point: { x: 10, y: 20 } },
    });
    const freed = store.encodeState();
    applyCommand(store, setConnectorEndCommand, {
      id: 'connector-flow',
      end: 'to',
      target: { point: { x: 10, y: 20 } },
    });
    expect(store.encodeState()).toEqual(freed);
  });

  it('tells apart a moved anchor, another object, an anchor made automatic and a moved point', () => {
    const store = createFixtureStore();
    const write = (target: z.input<typeof setConnectorEndInputSchema>['target']) =>
      applyCommand(store, setConnectorEndCommand, { id: 'connector-flow', end: 'from', target })
        .result.changedIds;
    expect(write({ objectId: 'sticky-idea', anchor: { x: 1, y: 0 } })).toEqual(['connector-flow']);
    expect(write({ objectId: 'sticky-idea', anchor: { x: 0, y: 0 } })).toEqual(['connector-flow']);
    expect(write({ objectId: 'sticky-idea', anchor: null })).toEqual(['connector-flow']);
    expect(write({ objectId: 'sticky-idea', anchor: { x: 0, y: 0 } })).toEqual(['connector-flow']);
    expect(write({ objectId: 'text-title', anchor: { x: 0, y: 0 } })).toEqual(['connector-flow']);
    expect(write({ point: { x: 1, y: 2 } })).toEqual(['connector-flow']);
    expect(write({ point: { x: 1, y: 3 } })).toEqual(['connector-flow']);
    expect(write({ objectId: 'text-title', anchor: null })).toEqual(['connector-flow']);
  });

  it('is one undo step', () => {
    const store = createFixtureStore();
    const history = createHistory(store, ADA.principalId);
    const before = endsOf(store);
    applyCommand(store, setConnectorEndCommand, {
      id: 'connector-flow',
      end: 'to',
      target: { point: { x: 10, y: 20 } },
    });
    history.undo();
    expect(endsOf(store)).toEqual(before);
  });

  it('refuses another type, a locked connector, a missing object and a bad target', () => {
    const store = createFixtureStore();
    const errorsOf = (input: unknown) =>
      expectRejected(store, setConnectorEndCommand, input).map(({ code }) => code);
    const freeTo = { end: 'to', target: { point: { x: 0, y: 0 } } };
    expect(errorsOf({ id: 'line-divider', ...freeTo })).toEqual(['unsupported-type']);
    expect(errorsOf({ id: 'gone', ...freeTo })).toEqual(['missing-object']);
    const toItself = { id: 'connector-flow', end: 'to', target: { objectId: 'connector-flow' } };
    expect(errorsOf(toItself).length).toBeGreaterThan(0);
    const toComment = { id: 'connector-flow', end: 'to', target: { objectId: 'comment-on-photo' } };
    expect(errorsOf(toComment).length).toBeGreaterThan(0);
    const toNothing = { id: 'connector-flow', end: 'to', target: { objectId: 'nothing' } };
    expect(errorsOf(toNothing).length).toBeGreaterThan(0);
    applyCommand(store, setLockedCommand, { ids: ['connector-flow'], locked: true });
    expect(errorsOf({ id: 'connector-flow', ...freeTo })).toEqual(['locked']);
  });

  it('frees both ends, making a free line', () => {
    const store = createFixtureStore();
    applyCommand(store, setConnectorEndCommand, {
      id: 'connector-flow',
      end: 'to',
      target: { point: { x: 10, y: 20 } },
    });
    applyCommand(store, setConnectorEndCommand, {
      id: 'connector-flow',
      end: 'from',
      target: { point: { x: 0, y: 0 } },
    });
    const connector = store.get(id('connector-flow'));
    expect(connector?.type === 'connector' ? [connector.from.kind, connector.to.kind] : []).toEqual(
      ['point', 'point'],
    );
  });

  it('refuses to free an end of a connector that hangs below a parent cycle', () => {
    const store = createFixtureStore();
    const group = fixtureObject('group-diagram', 'group');
    store.transact(BOB, (transaction) => {
      transaction.setObject({ ...group, id: id('loop-a'), parentId: id('loop-b') });
      transaction.setObject({ ...group, id: id('loop-b'), parentId: id('loop-a') });
      transaction.patchObject(id('connector-flow'), { parentId: id('loop-a') });
    });
    const errors = refusalsOn(storedBoardOf(store), setConnectorEndCommand, {
      id: 'connector-flow',
      end: 'to',
      target: { point: { x: 10, y: 10 } },
    });
    expect(errors).toEqual([
      expect.objectContaining({ code: 'parent-cycle', objectId: 'connector-flow' }),
    ]);
  });

  it('converges when two clients change the connector at once, keeping both changes', () => {
    const [ada, bob] = createSyncedPair();
    applyCommand(ada, setConnectorEndCommand, {
      id: 'connector-flow',
      end: 'to',
      target: { objectId: 'image-photo' },
    });
    applyCommand(
      bob,
      setConnectorEndCommand,
      { id: 'connector-flow', end: 'from', target: { point: { x: 5, y: 6 } } },
      BOB,
    );
    applyCommand(
      bob,
      moveObjectsCommand,
      { moves: [{ id: 'connector-flow', by: { x: 1, y: 1 } }] },
      BOB,
    );
    applyCommand(ada, setStyleCommand, {
      changes: [{ id: 'connector-flow', style: { route: 'curved' } }],
    });
    exchange(ada, bob);
    expect(new Map(bob.read().objects)).toEqual(new Map(ada.read().objects));
    expect(mustGet(ada, 'connector-flow')).toMatchObject({
      x: 1,
      y: 1,
      route: 'curved',
      from: { kind: 'point', x: 5, y: 6 },
      to: { kind: 'object', objectId: 'image-photo', anchor: null },
    });
  });
});
