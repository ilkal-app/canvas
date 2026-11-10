import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { SYSTEM_ORIGIN } from '../origin/transaction-origin.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { appendedByClientsBoard, stackedClientsUpdate } from './__fixtures__/stacked-clients.js';
import { countUpdateClients, MAX_UPDATE_CLIENTS } from './update-client-bound.js';
import { UpdateStampCheck } from './update-stamp-check.js';

// The relay refuses a writer's update of more than MAX_UPDATE_CLIENTS clients before
// scanning it. The bound is the relay's only: a store applies a whole board's state however
// many clients wrote it.

/**
 * A board every one of `clientCount` clients appended one value to, written with Yjs (slow past
 * a few thousand clients: Yjs's transactions visit every client).
 *
 * @param clientCount - How many clients wrote.
 * @returns Its state (format v1).
 */
function boardOfManyWriters(clientCount: number): Uint8Array {
  const doc = new Y.Doc();
  for (let client = 1; client <= clientCount; client += 1) {
    doc.clientID = client;
    doc.getArray<number>('notes').push([client]);
  }
  const state = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return state;
}

describe('countUpdateClients', () => {
  it('reads the hand-written honest board as Yjs writes it', () => {
    expect(appendedByClientsBoard(5)).toEqual(boardOfManyWriters(5));
  });

  it('counts the client blocks Yjs wrote, one per client', () => {
    expect(countUpdateClients(stackedClientsUpdate(3))).toBe(3);
    expect(countUpdateClients(appendedByClientsBoard(5))).toBe(5);
    expect(countUpdateClients(Y.encodeStateAsUpdate(new Y.Doc()))).toBe(0);
  });

  it('throws on bytes that do not start with a number', () => {
    expect(() => countUpdateClients(new Uint8Array())).toThrow();
  });
});

describe('the stamp check bounds the clients of a live update', () => {
  it('refuses an update past the bound before replaying it, whatever it holds', () => {
    const check = new UpdateStampCheck(new Y.Doc());
    // Built before the clock starts: encoding 10,001 client blocks by hand is the fixture's
    // cost, not the check's, and on a loaded runner it alone took most of the budget.
    const stacked = stackedClientsUpdate(MAX_UPDATE_CLIENTS + 1);
    const appended = appendedByClientsBoard(MAX_UPDATE_CLIENTS + 1);
    const start = performance.now();
    const verdicts = [check.check(stacked), check.check(appended)];
    // Reading one number: far under the replay's own cost.
    expect(performance.now() - start).toBeLessThan(100);
    expect(verdicts[0]).toEqual({ kind: 'too-many-clients', writers: [] });
    expect(verdicts[1]?.kind).toBe('too-many-clients');
  });

  it('checks an update at the bound as before', () => {
    const verdict = new UpdateStampCheck(new Y.Doc()).check(
      stackedClientsUpdate(MAX_UPDATE_CLIENTS),
    );
    expect(verdict).toMatchObject({ kind: 'unprovable', cause: 'missing-dependency' });
  });

  it('does not bound durable history', () => {
    const check = new UpdateStampCheck(new Y.Doc(), undefined, true);
    expect(check.check(stackedClientsUpdate(MAX_UPDATE_CLIENTS + 1)).kind).toBe('unprovable');
  });

  it('calls bytes it cannot count unreadable', () => {
    expect(new UpdateStampCheck(new Y.Doc()).check(new Uint8Array())).toMatchObject({
      kind: 'unprovable',
      cause: 'unreadable-update',
    });
  });
});

describe("the bound is the relay's only", () => {
  it('a store applies a whole board written by more clients than the bound', () => {
    const store = new YjsDocumentStore();
    const board = appendedByClientsBoard(MAX_UPDATE_CLIENTS + 1);
    store.applyUpdate(board, SYSTEM_ORIGIN);
    expect(Y.decodeStateVector(store.encodeStateVector()).size).toBe(MAX_UPDATE_CLIENTS + 1);
    store.destroy();
  });
});
