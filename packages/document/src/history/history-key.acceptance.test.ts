// An agent history key scopes undo and redo to that agent's writes on a shared store.
import { describe, expect, it } from 'vitest';

import type { PrincipalId } from '@canvas/schema';

import { applyCommand } from '../commands/__fixtures__/command-fixtures.js';
import { moveObjectsCommand } from '../commands/move-objects.js';
import { parseTransactionOrigin } from '../origin/transaction-origin.js';
import { createFixtureStore } from '../store/__fixtures__/store-fixtures.js';

import { createHistory } from './undo-manager.js';

const OPERATOR = 'user:ada' as PrincipalId;
const AGENT = 'agent:scout' as PrincipalId;

function agent(historyKey?: string) {
  return parseTransactionOrigin({
    kind: 'agent',
    principalId: AGENT,
    operatorId: OPERATOR,
    ...(historyKey === undefined ? {} : { historyKey }),
  });
}

describe('transaction origin and keyed history contract', () => {
  it('accepts an agent key and rejects invalid or non-agent keys', () => {
    expect(agent('Agent_09-z')).toMatchObject({ historyKey: 'Agent_09-z' });
    for (const historyKey of ['', 'two words', 'bad.dot', 'a'.repeat(65)]) {
      expect(() => agent(historyKey)).toThrow(RangeError);
    }
    for (const [kind, principalId] of [
      ['user', OPERATOR],
      ['undo', OPERATOR],
      ['system', 'system'],
    ] as const) {
      expect(() => parseTransactionOrigin({ kind, principalId, historyKey: 'agent-a' })).toThrow(
        RangeError,
      );
    }
  });

  it('undoes and redoes only the newest write in each key, including the default history', () => {
    const store = createFixtureStore();
    const historyA = createHistory(store, OPERATOR, { historyKey: 'agent-a' });
    const historyB = createHistory(store, OPERATOR, { historyKey: 'agent-b' });
    const historyDefault = createHistory(store, OPERATOR);
    const xOf = (objectId: string): number => {
      const x = store.get(objectId as never)?.x;
      if (x === undefined) throw new Error(`fixture object ${objectId} is missing`);
      return x;
    };
    const initialPhoto = xOf('image-photo');
    const initialVideo = xOf('video-demo');
    const initialFrame = xOf('frame-plan');
    const write = (objectId: string, delta: number, historyKey?: string) =>
      applyCommand(
        store,
        moveObjectsCommand,
        { moves: [{ id: objectId, by: { x: delta, y: 0 } }] },
        agent(historyKey),
      );
    const positions = () => [xOf('image-photo'), xOf('video-demo'), xOf('frame-plan')];
    try {
      write('image-photo', 10, 'agent-a');
      write('video-demo', 20, 'agent-b');
      write('frame-plan', 30);
      write('image-photo', 40, 'agent-a');
      expect(positions()).toEqual([initialPhoto + 50, initialVideo + 20, initialFrame + 30]);
      expect(historyA.undo()).toBe(true);
      expect(positions()).toEqual([initialPhoto + 10, initialVideo + 20, initialFrame + 30]);
      expect(historyB.undo()).toBe(true);
      expect(positions()).toEqual([initialPhoto + 10, initialVideo, initialFrame + 30]);
      expect(historyDefault.undo()).toBe(true);
      expect(positions()).toEqual([initialPhoto + 10, initialVideo, initialFrame]);
      expect(historyA.redo()).toBe(true);
      expect(positions()).toEqual([initialPhoto + 50, initialVideo, initialFrame]);
      expect(historyB.redo()).toBe(true);
      expect(positions()).toEqual([initialPhoto + 50, initialVideo + 20, initialFrame]);
      expect(historyDefault.redo()).toBe(true);
      expect(positions()).toEqual([initialPhoto + 50, initialVideo + 20, initialFrame + 30]);
      expect(historyA.undo()).toBe(true);
      expect(historyA.undo()).toBe(true);
      expect(positions()).toEqual([initialPhoto, initialVideo + 20, initialFrame + 30]);
      expect(historyA.canUndo()).toBe(false);
    } finally {
      historyA.destroy();
      historyB.destroy();
      historyDefault.destroy();
      store.destroy();
    }
  });

  it('keeps the existing unkeyed operator history for unkeyed agent writes only', () => {
    const store = createFixtureStore();
    const history = createHistory(store, OPERATOR);
    const initial = store.get('image-photo' as never)?.x;
    if (initial === undefined) throw new Error('fixture photo is missing');
    try {
      applyCommand(
        store,
        moveObjectsCommand,
        { moves: [{ id: 'image-photo', by: { x: 10, y: 0 } }] },
        agent('agent-a'),
      );
      expect(history.canUndo()).toBe(false);
      applyCommand(
        store,
        moveObjectsCommand,
        { moves: [{ id: 'image-photo', by: { x: 20, y: 0 } }] },
        agent(),
      );
      expect(history.undo()).toBe(true);
      expect(store.get('image-photo' as never)?.x).toBe(initial + 10);
      expect(history.redo()).toBe(true);
      expect(store.get('image-photo' as never)?.x).toBe(initial + 30);
    } finally {
      history.destroy();
      store.destroy();
    }
  });
});
