// Two free connector ends form a free line without changing legacy lines.
import { describe, expect, it } from 'vitest';

import { createHistory } from '../history/undo-manager.js';
import { ADA, createFixtureStore, id } from '../store/__fixtures__/store-fixtures.js';

import {
  applyCommand,
  expectDiff,
  expectRejected,
  mustGet,
} from './__fixtures__/command-fixtures.js';
import { connectCommand } from './connect.js';
import { setConnectorEndCommand } from './set-connector-end.js';
import { setLockedCommand } from './set-locked.js';

describe('free line commands', () => {
  it('creates two point ends with the chosen route and caps on the default page in one undo step', () => {
    const store = createFixtureStore();
    const history = createHistory(store, ADA.principalId);
    const before = store.read();
    const legacyLine = mustGet(store, 'line-divider');
    const { result, changes } = applyCommand(store, connectCommand, {
      id: 'free-line',
      from: { point: { x: 25, y: 35 } },
      to: { point: { x: 225, y: 85 } },
      route: 'curved',
      startCap: 'none',
      endCap: 'none',
    });
    expectDiff(before, store.read(), changes, { created: [result.id] });
    expect(mustGet(store, 'free-line')).toMatchObject({
      type: 'connector',
      parentId: null,
      pageId: 'page-1',
      from: { kind: 'point', x: 25, y: 35 },
      to: { kind: 'point', x: 225, y: 85 },
      route: 'curved',
      startCap: 'none',
      endCap: 'none',
    });
    expect(mustGet(store, 'line-divider')).toEqual(legacyLine);
    expect(history.undo()).toBe(true);
    expect(store.get(id('free-line'))).toBeUndefined();
    expect(mustGet(store, 'line-divider')).toEqual(legacyLine);
  });

  it('frees an attached end beside a free end and keeps the other point', () => {
    const store = createFixtureStore();
    applyCommand(store, connectCommand, {
      id: 'partly-free',
      from: { objectId: 'sticky-idea' },
      to: { point: { x: 300, y: 400 } },
    });
    const before = store.read();
    const { changes, result } = applyCommand(store, setConnectorEndCommand, {
      id: 'partly-free',
      end: 'from',
      target: { point: { x: 100, y: 200 } },
    });
    expect(result.changedIds).toEqual([id('partly-free')]);
    expectDiff(before, store.read(), changes, { updated: [id('partly-free')] });
    expect(mustGet(store, 'partly-free')).toMatchObject({
      from: { kind: 'point', x: 100, y: 200 },
      to: { kind: 'point', x: 300, y: 400 },
    });
  });

  it('still refuses a locked connector and a missing target without writing', () => {
    const store = createFixtureStore();
    applyCommand(store, connectCommand, {
      id: 'partly-free',
      from: { point: { x: 0, y: 0 } },
      to: { objectId: 'sticky-idea' },
    });
    expect(
      expectRejected(store, setConnectorEndCommand, {
        id: 'partly-free',
        end: 'to',
        target: { objectId: 'missing' },
      }).map((error) => error.code),
    ).toContain('missing-connector-target');
    applyCommand(store, setLockedCommand, { ids: ['partly-free'], locked: true });
    expect(
      expectRejected(store, setConnectorEndCommand, {
        id: 'partly-free',
        end: 'to',
        target: { point: { x: 2, y: 3 } },
      }).map((error) => error.code),
    ).toEqual(['locked']);
  });
});
