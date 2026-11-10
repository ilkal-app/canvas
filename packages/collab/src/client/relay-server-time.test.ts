import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { describe, expect, it, vi } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { YjsDocumentStore } from '@canvas/document';
import { encodeServerTime, parseTimeRequest } from '@canvas/schema';

import { ServerClock } from '../clock/server-clock.js';
import { ReactionChannel } from '../presence/reaction-channel.js';

import { OutboundQueue } from './outbound-queue.js';
import type { RelayConnectionHost } from './relay-connection-host.js';
import { RelayConnection } from './relay-connection.js';
import { decodeRelayMessage, RELAY_MESSAGE_TYPES } from './relay-protocol.js';

// A connection asks the relay's clock when the relay accepts its token and with each
// keepalive answer, and hands each `server-time` answer to the client's estimate.

const BOARD = 'board';

/**
 * A frame from the relay.
 *
 * @param type - The message type.
 * @param write - Writes the payload.
 * @returns The frame.
 */
function frame(type: number, write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarString(encoder, BOARD);
  encoding.writeVarUint(encoder, type);
  write(encoder);
  return encoding.toUint8Array(encoder);
}

/**
 * A stateless frame from the relay.
 *
 * @param payload - Its JSON payload.
 * @returns The frame.
 */
function stateless(payload: string): Uint8Array {
  return frame(RELAY_MESSAGE_TYPES.stateless, (encoder) => {
    encoding.writeVarString(encoder, payload);
  });
}

const AUTHENTICATED = frame(RELAY_MESSAGE_TYPES.auth, (encoder) => {
  encoding.writeVarUint(encoder, 2);
  encoding.writeVarString(encoder, 'read-write');
});

/**
 * The ids of the time requests among frames the client sent.
 *
 * @param sent - The frames.
 * @returns The ids, in order.
 */
function timeRequests(sent: readonly Uint8Array[]): number[] {
  return sent.flatMap((data) => {
    const decoder = decoding.createDecoder(data);
    if (decoding.readVarString(decoder) !== BOARD) return [];
    if (decoding.readVarUint(decoder) !== RELAY_MESSAGE_TYPES.stateless) return [];
    const id = parseTimeRequest(decoding.readVarString(decoder));
    return id === undefined ? [] : [id];
  });
}

/**
 * A connection over a fresh store, recording what it sends.
 *
 * @param serverClock - The client's estimate, if any.
 * @param reactions - The client's reactions, if any.
 * @returns The connection and the frames it sent.
 */
function connect(serverClock?: ServerClock, reactions?: ReactionChannel) {
  const awareness = new Awareness(new Y.Doc());
  awareness.setLocalState(null);
  const host: RelayConnectionHost = {
    documentName: BOARD,
    token: 'local-test-token',
    store: new YjsDocumentStore(),
    awareness,
    queue: new OutboundQueue(),
    reportError: vi.fn(),
    onStructRangeSplit: vi.fn(),
    applyRemoteUpdate: vi.fn(),
    onAuthenticated: vi.fn(),
    onSynced: vi.fn(),
    onProgress: vi.fn(),
    onRejected: vi.fn(),
    onClosedByRelay: vi.fn(),
    ...(serverClock === undefined ? {} : { serverClock }),
    ...(reactions === undefined ? {} : { reactions }),
  };
  const sent: Uint8Array[] = [];
  const connection = new RelayConnection(host, (data) => sent.push(data));
  return { connection, sent };
}

describe("the relay's clock on a connection", () => {
  it('decodes an answer, and ignores a malformed one', () => {
    const answer = stateless(encodeServerTime({ id: 3, nowMs: 1_770_000_000_000 }));
    expect(decodeRelayMessage(answer, BOARD)).toEqual({
      kind: 'server-time',
      id: 3,
      nowMs: 1_770_000_000_000,
    });
    expect(decodeRelayMessage(stateless('{"type":"server-time","id":3}'), BOARD)).toEqual({
      kind: 'ignored',
    });
  });

  it('asks on joining and with each keepalive, and feeds the answers to the estimate', () => {
    let at = 1000;
    const clock = new ServerClock({ now: () => at });
    const { connection, sent } = connect(clock);
    connection.start();
    expect(timeRequests(sent)).toEqual([]);
    connection.receive(AUTHENTICATED);
    const [first] = timeRequests(sent);
    expect(first).toBe(0);
    at += 40;
    connection.receive(stateless(encodeServerTime({ id: 0, nowMs: 9020 })));
    expect(clock.now()).toBe(9040);
    connection.receive(stateless('{"type":"keepalive"}'));
    expect(timeRequests(sent)).toEqual([0, 1]);
    connection.dispose();
  });

  it('asks nothing without an estimate to keep, and a stray answer is harmless', () => {
    const { connection, sent } = connect();
    connection.start();
    connection.receive(AUTHENTICATED);
    connection.receive(stateless('{"type":"keepalive"}'));
    connection.receive(stateless(encodeServerTime({ id: 0, nowMs: 5 })));
    expect(timeRequests(sent)).toEqual([]);
    connection.dispose();
  });
});

describe('reactions on a connection', () => {
  it('hands others’ reactions on once authenticated, and ignores malformed ones', () => {
    const reactions = new ReactionChannel();
    const heard: unknown[] = [];
    reactions.subscribe((event) => heard.push(event));
    const { connection } = connect(undefined, reactions);
    const event = { type: 'reaction', emoji: '👍', x: 1, y: 2, pageId: 'page-1', from: 'bob' };
    connection.start();
    connection.receive(stateless(JSON.stringify(event)));
    expect(heard).toEqual([]);
    connection.receive(AUTHENTICATED);
    connection.receive(stateless(JSON.stringify(event)));
    connection.receive(stateless(JSON.stringify({ ...event, emoji: '💣' })));
    expect(heard).toEqual([{ emoji: '👍', x: 1, y: 2, pageId: 'page-1', from: 'bob' }]);
    expect(decodeRelayMessage(stateless(JSON.stringify({ ...event, from: '' })), BOARD)).toEqual({
      kind: 'ignored',
    });
    connection.dispose();
  });
});
