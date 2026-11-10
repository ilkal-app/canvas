import { describe, expect, it } from 'vitest';

import {
  applyCommand,
  mustGet,
  NOW,
  testEnvironment,
} from '../commands/__fixtures__/command-fixtures.js';
import { createObjectCommand } from '../commands/create-object.js';
import { deleteObjectsCommand } from '../commands/delete-objects.js';
import { moveObjectsCommand } from '../commands/move-objects.js';
import { ADA, BOB, id, RELAY } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { SCOUT_FOR_ADA, SCOUT_FOR_BOB } from './__fixtures__/history-fixtures.js';
import {
  createBoard,
  expectConverged,
  movePhoto,
  PHOTO,
  STICKY,
} from './__fixtures__/operated-board.js';

// Ada's browser, Scout's process (an agent she operates, on the hosted MCP server) and
// Bob's browser each hold a store, linked through a relay. Scout's commands reach Ada's store as
// remote updates, which carry no origin; her history records them because the caller tells it
// Scout's Yjs client id writes for an agent she operates (in the app, from the relay's stamp).

describe("an operator's history records her agent's remote writes", () => {
  it('undoes and redoes what the agent created, on every client', () => {
    const { ada, scout, bob, relay, history } = createBoard();
    try {
      const { result } = applyCommand(
        scout,
        createObjectCommand,
        { object: STICKY },
        SCOUT_FOR_ADA,
        testEnvironment(11),
      );
      relay.deliver();
      expect(ada.get(result.id)).toBeDefined();
      expect(history.canUndo()).toBe(true);
      expect(history.undo()).toBe(true);
      relay.deliver();
      for (const store of [ada, scout, bob]) expect(store.get(result.id)).toBeUndefined();
      expect(history.redo()).toBe(true);
      relay.deliver();
      for (const store of [ada, scout, bob]) expect(store.get(result.id)).toBeDefined();
      expectConverged(ada, scout, bob);
    } finally {
      history.destroy();
    }
  });

  it("undoes the agent's delete", () => {
    const { ada, scout, bob, relay, history } = createBoard();
    try {
      applyCommand(scout, deleteObjectsCommand, { ids: ['image-photo'] }, SCOUT_FOR_ADA);
      relay.deliver();
      expect(ada.get(id('image-photo'))).toBeUndefined();
      expect(history.undo()).toBe(true);
      relay.deliver();
      for (const store of [ada, scout, bob]) expect(mustGet(store, 'image-photo')).toEqual(PHOTO);
    } finally {
      history.destroy();
    }
  });

  it("steps the user's and the agent's changes newest first", () => {
    const { ada, scout, bob, relay, history } = createBoard();
    try {
      movePhoto(ada, 10, ADA);
      relay.deliver();
      movePhoto(scout, 100, SCOUT_FOR_ADA);
      relay.deliver();
      expect(history.undo()).toBe(true);
      expect(mustGet(ada, 'image-photo').x).toBe(PHOTO.x + 10);
      // Ada's own step is not refused for Scout's later write: it was hers too, and is undone.
      expect(history.undo()).toBe(true);
      relay.deliver();
      for (const store of [ada, scout, bob]) {
        expect(mustGet(store, 'image-photo')).toEqual(PHOTO);
      }
      expect(history.redo()).toBe(true);
      expect(history.redo()).toBe(true);
      relay.deliver();
      for (const store of [ada, scout, bob]) {
        expect(mustGet(store, 'image-photo').x).toBe(PHOTO.x + 110);
      }
    } finally {
      history.destroy();
    }
  });

  it("keeps another person's later edit: the agent's creation is not removed", () => {
    const { ada, scout, bob, relay, history } = createBoard();
    try {
      const { result } = applyCommand(
        scout,
        createObjectCommand,
        { object: STICKY },
        SCOUT_FOR_ADA,
        testEnvironment(11),
      );
      relay.deliver();
      applyCommand(
        bob,
        moveObjectsCommand,
        { moves: [{ id: result.id, by: { x: 50, y: 0 } }] },
        BOB,
        { clock: () => NOW + 1_000, createId: () => id('bob-1') },
      );
      relay.deliver();
      expect(history.undo()).toBe(false);
      expect(history.lastProtection()).toBeDefined();
      relay.deliver();
      for (const store of [ada, scout, bob]) expect(store.get(result.id)).toBeDefined();
    } finally {
      history.destroy();
    }
  });

  it('records no agent the caller does not name, nor anyone without the option', () => {
    for (const isTold of [true, false]) {
      const { ada, scout, bob, relay, history } = createBoard({ isTold });
      try {
        movePhoto(bob, 10, BOB);
        relay.deliver();
        // Scout operated by Bob writes under Scout's client id, but the option is Ada's word.
        movePhoto(scout, 20, isTold ? SCOUT_FOR_BOB : SCOUT_FOR_ADA);
        relay.deliver();
        expect(history.canUndo()).toBe(isTold);
        if (!isTold) continue;
        // Scout's write is recorded (the caller named its client id); Bob's is not.
        expect(history.undo()).toBe(true);
        expect(history.canUndo()).toBe(false);
        expect(mustGet(ada, 'image-photo').x).toBe(PHOTO.x + 10);
      } finally {
        history.destroy();
      }
    }
  });

  it('records no remote transaction written under several client ids', () => {
    const { ada, scout, bob, history } = createBoard();
    const both = new YjsDocumentStore();
    try {
      movePhoto(scout, 20, SCOUT_FOR_ADA);
      movePhoto(bob, 10, BOB);
      // One update holding both writes, as the sync of a reconnecting client may deliver it.
      both.applyUpdate(scout.encodeState(), RELAY);
      both.applyUpdate(bob.encodeState(), RELAY);
      ada.applyUpdate(both.encodeState(ada.encodeStateVector()), RELAY);
      expect(mustGet(ada, 'image-photo').x).not.toBe(PHOTO.x);
      expect(history.canUndo()).toBe(false);
    } finally {
      both.destroy();
      history.destroy();
    }
  });

  it("never merges the agent's step with the user's within the capture window", () => {
    const { ada, scout, relay, history } = createBoard({ captureTimeout: 60_000 });
    try {
      movePhoto(ada, 1, ADA);
      relay.deliver();
      movePhoto(scout, 10, SCOUT_FOR_ADA);
      relay.deliver();
      movePhoto(ada, 100, ADA);
      expect(history.undo()).toBe(true);
      expect(mustGet(ada, 'image-photo').x).toBe(PHOTO.x + 11);
      expect(history.undo()).toBe(true);
      expect(mustGet(ada, 'image-photo').x).toBe(PHOTO.x + 1);
      expect(history.undo()).toBe(true);
      expect(mustGet(ada, 'image-photo')).toEqual(PHOTO);
      expect(history.canUndo()).toBe(false);
    } finally {
      history.destroy();
    }
  });
});
