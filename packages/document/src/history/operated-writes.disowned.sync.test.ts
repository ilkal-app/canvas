import { describe, expect, it } from 'vitest';

import {
  applyCommand,
  mustGet,
  testEnvironment,
} from '../commands/__fixtures__/command-fixtures.js';
import { createObjectCommand } from '../commands/create-object.js';
import { ADA } from '../store/__fixtures__/store-fixtures.js';

import { ADA_ID, BOB_ID, SCOUT_FOR_ADA } from './__fixtures__/history-fixtures.js';
import {
  ADA_CLIENT,
  createBoard,
  movePhoto,
  PHOTO,
  STICKY,
  storeOf,
} from './__fixtures__/operated-board.js';
import { createHistory } from './undo-manager.js';

// A step recorded under a candidate client id (an agent's awareness id before the relay
// stamped it) is undone only if the relay comes to vouch for the id: else it is dropped
// unapplied, and its writes are another writer's for the guards.

describe('an agent step under an id the relay never vouched for', () => {
  it("drops, unapplied, a step under an id the relay never vouched for, and undoes Ada's", () => {
    let isVouched = true;
    const { ada, scout, bob, relay, history } = createBoard({ owns: () => isVouched });
    try {
      movePhoto(ada, 10, ADA);
      relay.deliver();
      // Someone writes under Scout's awareness id before Scout does: recorded as a candidate.
      const { result } = applyCommand(
        scout,
        createObjectCommand,
        { object: STICKY },
        SCOUT_FOR_ADA,
        testEnvironment(11),
      );
      relay.deliver();
      expect(history.canUndo()).toBe(true);
      // The relay vouches the id for someone else: it is not Ada's agent's after all.
      isVouched = false;
      // An undo control asking now sees Ada's step; the dropped one does not count.
      expect(history.canUndo()).toBe(true);
      expect(history.undo()).toBe(true);
      relay.deliver();
      for (const store of [ada, scout, bob]) {
        expect(store.get(result.id)).toBeDefined();
        expect(mustGet(store, 'image-photo')).toEqual(PHOTO);
      }
      expect(history.canUndo()).toBe(false);
    } finally {
      history.destroy();
    }
  });

  it("counts a disowned id's writes as another writer's: Ada's older step is kept", () => {
    let isVouched = true;
    const { ada, scout, relay, history } = createBoard({ owns: () => isVouched });
    try {
      movePhoto(ada, 10, ADA);
      relay.deliver();
      movePhoto(scout, 100, SCOUT_FOR_ADA);
      relay.deliver();
      isVouched = false;
      // Scout's step is dropped; Ada's move is then refused, for the write since is not hers.
      expect(history.undo()).toBe(false);
      expect(mustGet(ada, 'image-photo').x).toBe(PHOTO.x + 110);
    } finally {
      history.destroy();
    }
  });

  it('tells subscribers, and canUndo, when only disowned steps were left', () => {
    let isVouched = true;
    const { scout, relay, history } = createBoard({ owns: () => isVouched });
    try {
      movePhoto(scout, 100, SCOUT_FOR_ADA);
      relay.deliver();
      const states: boolean[] = [];
      history.subscribe(({ canUndo }) => states.push(canUndo));
      isVouched = false;
      expect(history.undo()).toBe(false);
      expect(states).toEqual([false]);
      expect(history.canUndo()).toBe(false);
    } finally {
      history.destroy();
    }
  });

  it('waits, dropping nothing, while the id is not known yet, then undoes it once vouched', () => {
    let isVouched: boolean | undefined;
    const { ada, scout, relay, history } = createBoard({ owns: () => isVouched });
    try {
      movePhoto(scout, 100, SCOUT_FOR_ADA);
      relay.deliver();
      // The agent's first write, before the relay's stamp: a control may ask, an undo waits.
      expect(history.canUndo()).toBe(true);
      expect(history.undo()).toBe(false);
      expect(mustGet(ada, 'image-photo').x).toBe(PHOTO.x + 100);
      isVouched = true;
      expect(history.undo()).toBe(true);
      expect(mustGet(ada, 'image-photo')).toEqual(PHOTO);
    } finally {
      history.destroy();
    }
  });

  it('refuses an operatedWriters without its two functions', () => {
    const store = storeOf(ADA_CLIENT);
    for (const operatedWriters of [7, () => true, { records: () => true }]) {
      const options = { operatedWriters } as unknown as Parameters<typeof createHistory>[2];
      expect(() => createHistory(store, ADA_ID, options)).toThrow(TypeError);
    }
    expect(() => createHistory(store, BOB_ID, {})).not.toThrow();
  });
});
