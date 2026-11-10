import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { scanUpdate } from '../assets/update-scan.js';

import { encodeHandUpdate } from './__fixtures__/hand-encoded-update.js';
import { relayHolding } from './__fixtures__/stamp-check-fixtures.js';
import { replayIntegration } from './update-integration.js';

// The replay of Yjs's integration that the relay's stamp check counts on (fix round 2):
// what Yjs integrates, skips, keeps pending, or would throw on or corrupt its lists with.

/**
 * Replays an update into a document.
 *
 * @param doc - The document.
 * @param update - The update.
 * @returns The replay.
 */
function replay(doc: Y.Doc, update: Uint8Array): ReturnType<typeof replayIntegration> {
  return replayIntegration(
    doc,
    scanUpdate(update, new Set(), { shouldKeepEveryStruct: true }),
    1e6,
  );
}

/**
 * The clocks of client `client` the replay integrated.
 *
 * @param result - The replay.
 * @param client - The client.
 * @returns Their first clocks, ascending.
 */
function integratedClocks(result: ReturnType<typeof replay>, client: number): number[] {
  return [...result.landings.keys()]
    .filter((item) => item.client === client)
    .map((item) => item.clock)
    .sort((first, second) => first - second);
}

describe('replayIntegration', () => {
  it('integrates what Yjs integrates, skips what the document holds, and names the gaps', () => {
    const writer = new Y.Doc();
    writer.clientID = 5;
    const updates: Uint8Array[] = [];
    writer.on('update', (update: Uint8Array) => updates.push(update));
    for (const key of ['a', 'b', 'c', 'd']) writer.getMap('objects').set(key, key);
    const board = relayHolding(updates[0] ?? new Uint8Array());
    const whole = replay(board, Y.encodeStateAsUpdate(writer));
    expect(integratedClocks(whole, 5)).toEqual([1, 2, 3]);
    expect(whole.heldBack.size).toBe(0);
    const gap = replay(
      board,
      Y.mergeUpdates([updates[1] ?? new Uint8Array(), updates[3] ?? new Uint8Array()]),
    );
    expect(integratedClocks(gap, 5)).toEqual([1]);
    expect(gap.heldBack).toEqual(new Map([[5, 'clock-gap']]));
  });

  it('holds back a client whose neighbour nobody sent, and those that follow it', () => {
    const update = encodeHandUpdate([
      { client: 6, clock: 0, structs: [{ origin: Y.createID(9, 0), content: { kind: 'map' } }] },
      { client: 7, clock: 0, structs: [{ origin: Y.createID(6, 0), content: { kind: 'map' } }] },
    ]);
    const result = replay(new Y.Doc(), update);
    expect(result.landings.size).toBe(0);
    expect(result.heldBack).toEqual(
      new Map([
        [7, 'missing-dependency'],
        [6, 'missing-dependency'],
      ]),
    );
  });

  it('accepts the rest of an item the document holds part of, as a sync racing a live update', () => {
    const writer = new Y.Doc();
    writer.clientID = 5;
    const updates: Uint8Array[] = [];
    writer.on('update', (update: Uint8Array) => updates.push(update));
    writer.getText('notes').insert(0, 'a');
    writer.getText('notes').insert(1, 'b');
    // The writer holds one merged item "ab"; the relay already has "a".
    const board = relayHolding(updates[0] ?? new Uint8Array());
    const result = replay(board, Y.encodeStateAsUpdate(writer));
    expect(result.isMalformed).toBe(false);
    expect(integratedClocks(result, 5)).toEqual([0]);
  });

  it('calls malformed what Yjs would throw on or link into the wrong list', () => {
    const board = relayHolding(
      encodeHandUpdate([
        {
          client: 5,
          clock: 0,
          structs: [{ parent: 'notes', content: { kind: 'string', text: 'a' } }],
        },
      ]),
    );
    const forward = encodeHandUpdate([
      { client: 8, clock: 0, structs: [{ origin: Y.createID(8, 3), content: { kind: 'map' } }] },
    ]);
    // Clock 0 is held (in `notes`); the rest, clock 1, names another list.
    const elsewhere = encodeHandUpdate([
      {
        client: 5,
        clock: 0,
        structs: [{ parent: 'other', content: { kind: 'string', text: 'xy' } }],
      },
    ]);
    const longValue = encodeHandUpdate([
      {
        client: 9,
        clock: 0,
        structs: [{ parent: 'objects', parentSub: 'k', content: { kind: 'string', text: 'ab' } }],
      },
    ]);
    for (const update of [forward, elsewhere, longValue]) {
      expect(replay(board, update).isMalformed).toBe(true);
    }
  });
});
