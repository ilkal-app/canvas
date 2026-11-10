import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { operatedWriterOf, OperatedWrites } from './operated-writes.js';

describe('OperatedWrites', () => {
  it('covers a range only when every clock of it was recorded', () => {
    const writes = new OperatedWrites();
    writes.record(7, 0, 4);
    writes.record(7, 4, 6);
    writes.record(7, 10, 12);
    writes.record(7, 3, 3);
    expect(writes.covers(7, 0, 6)).toBe(true);
    expect(writes.covers(7, 2, 5)).toBe(true);
    expect(writes.covers(7, 5, 11)).toBe(false);
    expect(writes.covers(7, 10, 12)).toBe(true);
    expect(writes.covers(7, 11, 13)).toBe(false);
    expect(writes.covers(8, 0, 1)).toBe(false);
  });

  it('covers nothing of a client id it no longer owns', () => {
    let isOwned = true;
    const writes = new OperatedWrites(() => isOwned);
    writes.record(7, 0, 4);
    expect(writes.covers(7, 0, 4)).toBe(true);
    isOwned = false;
    expect(writes.covers(7, 0, 4)).toBe(false);
  });

  it('keeps a range recorded before an earlier one in order', () => {
    const writes = new OperatedWrites();
    writes.record(7, 10, 12);
    writes.record(7, 2, 4);
    writes.record(7, 4, 10);
    expect(writes.covers(7, 2, 12)).toBe(true);
    expect(writes.covers(7, 0, 3)).toBe(false);
  });
});

describe('operatedWriterOf', () => {
  /**
   * The transaction of applying an update written by the given client ids.
   *
   * @param clients - The writers.
   * @returns The finished transaction.
   * @throws {Error} When applying the update ran no transaction.
   */
  function transactionOf(clients: readonly number[]): Y.Transaction {
    const source = new Y.Doc();
    for (const client of clients) {
      source.clientID = client;
      source.getMap('objects').set(String(client), client);
    }
    const target = new Y.Doc();
    let seen: Y.Transaction | undefined;
    target.on('afterTransaction', (transaction: Y.Transaction) => {
      seen = transaction;
    });
    Y.applyUpdate(target, Y.encodeStateAsUpdate(source), 'relay');
    if (seen === undefined) throw new Error('no transaction');
    return seen;
  }

  it('names the one writer the predicate accepts', () => {
    expect(operatedWriterOf(transactionOf([5]), (client) => client === 5)).toBe(5);
    expect(operatedWriterOf(transactionOf([5]), () => false)).toBeUndefined();
  });

  it('names nobody for several writers or none', () => {
    expect(operatedWriterOf(transactionOf([5, 6]), () => true)).toBeUndefined();
    expect(operatedWriterOf(transactionOf([]), () => true)).toBeUndefined();
  });
});
