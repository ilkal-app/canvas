import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { describe, expect, it } from 'vitest';

import {
  decodeRelayMessage,
  encodeAuthMessage,
  encodeAwarenessMessage,
  encodeKeepalive,
  encodePong,
  encodeSyncStep1,
  encodeSyncStep2,
  encodeTokenRefresh,
  encodeUpdateMessage,
  RELAY_MESSAGE_TYPES,
} from './relay-protocol.js';

const DOC = 'board-1';

// Builds a message the way the relay frames it: document name, message type, then `write`.
function relayFrame(type: number, write: (encoder: encoding.Encoder) => void, doc = DOC) {
  const encoder = encoding.createEncoder();
  encoding.writeVarString(encoder, doc);
  encoding.writeVarUint(encoder, type);
  write(encoder);
  return encoding.toUint8Array(encoder);
}

describe('encoding client messages', () => {
  it('frames the token as a Hocuspocus authentication message', () => {
    const decoder = decoding.createDecoder(encodeAuthMessage(DOC, 'jwt'));
    expect(decoding.readVarString(decoder)).toBe(DOC);
    expect(decoding.readVarUint(decoder)).toBe(RELAY_MESSAGE_TYPES.auth);
    expect(decoding.readVarUint(decoder)).toBe(0);
    expect(decoding.readVarString(decoder)).toBe('jwt');
    expect(decoding.hasContent(decoder)).toBe(false);
  });

  it('frames sync step 1, step 2 and updates as y-protocols sync messages', () => {
    const payload = new Uint8Array([1, 2, 3]);
    const cases = [
      [encodeSyncStep1(DOC, payload), 0],
      [encodeSyncStep2(DOC, payload), 1],
      [encodeUpdateMessage(DOC, payload), 2],
    ] as const;
    for (const [message, syncType] of cases) {
      const decoder = decoding.createDecoder(message);
      expect(decoding.readVarString(decoder)).toBe(DOC);
      expect(decoding.readVarUint(decoder)).toBe(RELAY_MESSAGE_TYPES.sync);
      expect(decoding.readVarUint(decoder)).toBe(syncType);
      expect(decoding.readVarUint8Array(decoder)).toEqual(payload);
    }
  });

  it('frames an awareness update and a pong', () => {
    const decoder = decoding.createDecoder(encodeAwarenessMessage(DOC, new Uint8Array([9])));
    expect(decoding.readVarString(decoder)).toBe(DOC);
    expect(decoding.readVarUint(decoder)).toBe(RELAY_MESSAGE_TYPES.awareness);
    expect(decoding.readVarUint8Array(decoder)).toEqual(new Uint8Array([9]));
    expect(encodePong()).toEqual(new Uint8Array([RELAY_MESSAGE_TYPES.pong]));
  });
});

describe('decodeRelayMessage', () => {
  const bytes = new Uint8Array([4, 5]);

  it('reads the three sync messages', () => {
    const sync = (syncType: number) =>
      relayFrame(RELAY_MESSAGE_TYPES.sync, (encoder) => {
        encoding.writeVarUint(encoder, syncType);
        encoding.writeVarUint8Array(encoder, bytes);
      });
    expect(decodeRelayMessage(sync(0), DOC)).toEqual({ kind: 'sync-step-1', stateVector: bytes });
    expect(decodeRelayMessage(sync(1), DOC)).toEqual({ kind: 'sync-step-2', update: bytes });
    expect(decodeRelayMessage(sync(2), DOC)).toEqual({ kind: 'update', update: bytes });
    expect(() => decodeRelayMessage(sync(7), DOC)).toThrow(RangeError);
  });

  it('reads the authentication answers', () => {
    const auth = (write: (encoder: encoding.Encoder) => void) =>
      relayFrame(RELAY_MESSAGE_TYPES.auth, write);
    const authenticated = auth((encoder) => {
      encoding.writeVarUint(encoder, 2);
      encoding.writeVarString(encoder, 'readonly');
    });
    const denied = auth((encoder) => {
      encoding.writeVarUint(encoder, 1);
      encoding.writeVarString(encoder, 'expired');
    });
    const tokenRequest = auth((encoder) => {
      encoding.writeVarUint(encoder, 0);
    });
    expect(decodeRelayMessage(authenticated, DOC)).toEqual({
      kind: 'authenticated',
      isReadOnly: true,
    });
    expect(decodeRelayMessage(denied, DOC)).toEqual({
      kind: 'permission-denied',
      reason: 'expired',
    });
    expect(decodeRelayMessage(tokenRequest, DOC)).toEqual({ kind: 'token-request' });
    const unknownAuth = auth((encoder) => {
      encoding.writeVarUint(encoder, 9);
    });
    expect(() => decodeRelayMessage(unknownAuth, DOC)).toThrow(RangeError);
  });

  it('reads awareness, awareness queries, sync status and close', () => {
    const awareness = relayFrame(RELAY_MESSAGE_TYPES.awareness, (encoder) => {
      encoding.writeVarUint8Array(encoder, bytes);
    });
    const query = relayFrame(RELAY_MESSAGE_TYPES.queryAwareness, () => undefined);
    const status = (flag: number) =>
      relayFrame(RELAY_MESSAGE_TYPES.syncStatus, (encoder) => {
        encoding.writeVarInt(encoder, flag);
      });
    const close = relayFrame(RELAY_MESSAGE_TYPES.close, (encoder) => {
      encoding.writeVarString(encoder, 'bye');
    });
    expect(decodeRelayMessage(awareness, DOC)).toEqual({ kind: 'awareness', update: bytes });
    expect(decodeRelayMessage(query, DOC)).toEqual({ kind: 'query-awareness' });
    expect(decodeRelayMessage(status(1), DOC)).toEqual({ kind: 'sync-status', isApplied: true });
    expect(decodeRelayMessage(status(0), DOC)).toEqual({ kind: 'sync-status', isApplied: false });
    expect(decodeRelayMessage(close, DOC)).toEqual({ kind: 'close', reason: 'bye' });
  });

  it('reads a connection-level ping, which carries no document name', () => {
    expect(decodeRelayMessage(new Uint8Array([RELAY_MESSAGE_TYPES.ping]), DOC)).toEqual({
      kind: 'ping',
    });
  });

  it('ignores messages for other documents, stateless payloads and unknown types', () => {
    const other = relayFrame(RELAY_MESSAGE_TYPES.queryAwareness, () => undefined, 'board-2');
    const stateless = relayFrame(RELAY_MESSAGE_TYPES.stateless, (encoder) => {
      encoding.writeVarString(encoder, '{}');
    });
    const unknown = relayFrame(42, () => undefined);
    expect(decodeRelayMessage(other, DOC)).toEqual({ kind: 'ignored' });
    expect(decodeRelayMessage(stateless, DOC)).toEqual({ kind: 'ignored' });
    expect(decodeRelayMessage(unknown, DOC)).toEqual({ kind: 'ignored' });
  });

  it('throws on a truncated message', () => {
    const truncated = relayFrame(RELAY_MESSAGE_TYPES.sync, (encoder) => {
      encoding.writeVarUint(encoder, 1);
    });
    expect(() => decodeRelayMessage(truncated, DOC)).toThrow();
  });
});

describe('token refresh messages', () => {
  /**
   * A stateless frame from the relay.
   *
   * @param payload - Its payload.
   * @returns The frame.
   */
  function stateless(payload: string): Uint8Array {
    return relayFrame(RELAY_MESSAGE_TYPES.stateless, (encoder) => {
      encoding.writeVarString(encoder, payload);
    });
  }

  it('frames a refresh as a stateless message carrying the token', () => {
    const decoder = decoding.createDecoder(encodeTokenRefresh(DOC, 'a.b.c'));
    expect(decoding.readVarString(decoder)).toBe(DOC);
    expect(decoding.readVarUint(decoder)).toBe(RELAY_MESSAGE_TYPES.stateless);
    expect(JSON.parse(decoding.readVarString(decoder))).toEqual({
      type: 'token-refresh',
      token: 'a.b.c',
    });
    expect(decoding.hasContent(decoder)).toBe(false);
  });

  it("reads the relay's announcement and acknowledgement", () => {
    expect(
      decodeRelayMessage(stateless('{"type":"token-expiry","expiresInMs":599000}'), DOC),
    ).toEqual({ kind: 'token-expiry', expiresInMs: 599_000 });
    expect(
      decodeRelayMessage(stateless('{"type":"token-refreshed","expiresInMs":0}'), DOC),
    ).toEqual({
      kind: 'token-refreshed',
      expiresInMs: 0,
    });
  });

  it('ignores every other stateless payload, never throwing', () => {
    const payloads = [
      'not json',
      'null',
      '[]',
      '{"type":"token-expiry"}',
      '{"type":"token-expiry","expiresInMs":-1}',
      '{"type":"token-expiry","expiresInMs":"10"}',
      '{"type":"token-expiry","expiresInMs":1e999}',
      '{"type":"token-refresh","token":"a.b.c"}',
      JSON.stringify({ type: 'token-expiry', expiresInMs: 1, padding: 'x'.repeat(5000) }),
    ];
    for (const payload of payloads) {
      expect(decodeRelayMessage(stateless(payload), DOC)).toEqual({ kind: 'ignored' });
    }
  });
});

describe('the keepalive', () => {
  it("reads the relay's keepalive and frames the answer as a stateless keepalive", () => {
    const keepalive = relayFrame(RELAY_MESSAGE_TYPES.stateless, (encoder) => {
      encoding.writeVarString(encoder, '{"type":"keepalive"}');
    });
    expect(decodeRelayMessage(keepalive, DOC)).toEqual({ kind: 'keepalive' });
    const decoder = decoding.createDecoder(encodeKeepalive(DOC));
    expect(decoding.readVarString(decoder)).toBe(DOC);
    expect(decoding.readVarUint(decoder)).toBe(RELAY_MESSAGE_TYPES.stateless);
    expect(JSON.parse(decoding.readVarString(decoder))).toEqual({ type: 'keepalive' });
  });
});
