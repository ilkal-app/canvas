// The relay's wire protocol, as the client speaks it: Hocuspocus 4 framing (a document name,
// a message type, a payload) around y-protocols' sync and awareness messages. Mirrors
// @hocuspocus/provider's MessageReceiver and OutgoingMessages and @hocuspocus/common's auth
// messages; the relay integration tests (tooling/e2e-sync) hold the client to the real server.
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { messageYjsSyncStep1, messageYjsSyncStep2, messageYjsUpdate } from 'y-protocols/sync';

import {
  encodeTimeRequest,
  parseReactionEvent,
  parseServerTime,
  type ReactionEvent,
} from '@canvas/schema';

/**
 * The origin awareness changes made by the connection carry (relayed states, and remote states
 * cleared on disconnect), so they are never sent back to the relay. Anything but `'local'` is
 * remote to the presence channel.
 */
export const RELAY_AWARENESS_ORIGIN = 'relay';

/** Hocuspocus message types (`MessageType` in `@hocuspocus/provider`). */
export const RELAY_MESSAGE_TYPES = Object.freeze({
  sync: 0,
  awareness: 1,
  auth: 2,
  queryAwareness: 3,
  stateless: 5,
  close: 7,
  syncStatus: 8,
  ping: 9,
  pong: 10,
});

/** Hocuspocus authentication sub-messages (`AuthMessageType` in `@hocuspocus/common`). */
const AUTH_TOKEN = 0;
const AUTH_PERMISSION_DENIED = 1;
const AUTH_AUTHENTICATED = 2;

/** The relay's two messages about a connection's token. */
export type TokenLifetimeKind = 'token-expiry' | 'token-refreshed';

/**
 * The longest stateless payload the client reads, in characters: the relay's stateless frames
 * are bounded at 4 KiB too.
 */
const MAX_STATELESS_CHARS = 4000;

/** A message from the relay, decoded. */
export type RelayMessage =
  /** The relay's state vector: answer with what it lacks. */
  | { readonly kind: 'sync-step-1'; readonly stateVector: Uint8Array }
  /** What the client lacked when it sent its state vector. */
  | { readonly kind: 'sync-step-2'; readonly update: Uint8Array }
  /** A peer's update, relayed. */
  | { readonly kind: 'update'; readonly update: Uint8Array }
  /** Peers' awareness states. */
  | { readonly kind: 'awareness'; readonly update: Uint8Array }
  /** The relay asks for every awareness state the client knows. */
  | { readonly kind: 'query-awareness' }
  /** The token was accepted; a read-only connection's updates are refused. */
  | { readonly kind: 'authenticated'; readonly isReadOnly: boolean }
  /** The token was refused, with the relay's reason (`expired`, `bad-signature`, ...). */
  | { readonly kind: 'permission-denied'; readonly reason: string }
  /** The relay asks for the token again. */
  | { readonly kind: 'token-request' }
  /** Whether the relay applied the client's last update or step 2. */
  | { readonly kind: 'sync-status'; readonly isApplied: boolean }
  /** The relay closed this document's connection. */
  | { readonly kind: 'close'; readonly reason: string }
  /** A connection-level keepalive: answer with a pong. */
  | { readonly kind: 'ping' }
  /**
   * What the connection's token has left by the relay's clock: on joining (`token-expiry`, which
   * also says the relay accepts refreshes) and after an accepted refresh (`token-refreshed`).
   */
  | { readonly kind: TokenLifetimeKind; readonly expiresInMs: number }
  /** The relay's keepalive: answer with one, so a quiet connection stays open. */
  | { readonly kind: 'keepalive' }
  /** Authenticated notice prompting an authorized thread refetch. */
  | { readonly kind: 'threads-changed' }
  /** Authenticated notice prompting an authorized refetch of the board's vote. */
  | { readonly kind: 'votes-changed' }
  /** Someone else's reaction, fanned out by the relay. */
  | { readonly kind: 'reaction'; readonly event: ReactionEvent }
  /** The relay's clock, answering a `time-request`. */
  | { readonly kind: 'server-time'; readonly id: number; readonly nowMs: number }
  /** Anything the client does not act on: another document, other stateless payloads, new types. */
  | { readonly kind: 'ignored' };

/**
 * Starts a message: the document name, then the message type.
 *
 * @param documentName - The board id.
 * @param type - One of {@link RELAY_MESSAGE_TYPES}.
 * @returns The encoder, ready for the payload.
 */
function startMessage(documentName: string, type: number): encoding.Encoder {
  const encoder = encoding.createEncoder();
  encoding.writeVarString(encoder, documentName);
  encoding.writeVarUint(encoder, type);
  return encoder;
}

/**
 * Encodes a sync message carrying one byte array.
 *
 * @param documentName - The board id.
 * @param syncType - The y-protocols sync message type.
 * @param payload - The state vector or update.
 * @returns The message bytes.
 */
function encodeSyncMessage(documentName: string, syncType: number, payload: Uint8Array) {
  const encoder = startMessage(documentName, RELAY_MESSAGE_TYPES.sync);
  encoding.writeVarUint(encoder, syncType);
  encoding.writeVarUint8Array(encoder, payload);
  return encoding.toUint8Array(encoder);
}

/**
 * Encodes the authentication message that opens a document on the relay.
 *
 * @param documentName - The board id.
 * @param token - The board token.
 * @returns The message bytes.
 */
export function encodeAuthMessage(documentName: string, token: string): Uint8Array {
  const encoder = startMessage(documentName, RELAY_MESSAGE_TYPES.auth);
  encoding.writeVarUint(encoder, AUTH_TOKEN);
  encoding.writeVarString(encoder, token);
  return encoding.toUint8Array(encoder);
}

/**
 * Encodes a token refresh: a stateless message carrying
 * `{ "type": "token-refresh", "token": ... }`, which the relay answers `token-refreshed` or with a
 * close.
 *
 * @param documentName - The board id.
 * @param token - The new board token.
 * @returns The message bytes.
 */
export function encodeTokenRefresh(documentName: string, token: string): Uint8Array {
  const encoder = startMessage(documentName, RELAY_MESSAGE_TYPES.stateless);
  encoding.writeVarString(encoder, JSON.stringify({ type: 'token-refresh', token }));
  return encoding.toUint8Array(encoder);
}

/**
 * Encodes the answer to the relay's keepalive: a stateless `{ "type": "keepalive" }`,
 * which the relay counts as traffic and otherwise ignores.
 *
 * @param documentName - The board id.
 * @returns The message bytes.
 */
export function encodeKeepalive(documentName: string): Uint8Array {
  const encoder = startMessage(documentName, RELAY_MESSAGE_TYPES.stateless);
  encoding.writeVarString(encoder, '{"type":"keepalive"}');
  return encoding.toUint8Array(encoder);
}

/**
 * Encodes a stateless message carrying a payload the client sends as is (a reaction).
 *
 * @param documentName - The board id.
 * @param payload - The JSON payload.
 * @returns The message bytes.
 */
export function encodeStatelessMessage(documentName: string, payload: string): Uint8Array {
  const encoder = startMessage(documentName, RELAY_MESSAGE_TYPES.stateless);
  encoding.writeVarString(encoder, payload);
  return encoding.toUint8Array(encoder);
}

/**
 * Encodes a request for the relay's clock: a stateless `{ "type": "time-request",
 * "id": n }`, which the relay answers `server-time` with the same id.
 *
 * @param documentName - The board id.
 * @param id - The request's id (`ServerClock.request`).
 * @returns The message bytes.
 */
export function encodeTimeRequestMessage(documentName: string, id: number): Uint8Array {
  const encoder = startMessage(documentName, RELAY_MESSAGE_TYPES.stateless);
  encoding.writeVarString(encoder, encodeTimeRequest(id));
  return encoding.toUint8Array(encoder);
}

/**
 * Encodes sync step 1: the client's state vector, asking for what it lacks.
 *
 * @param documentName - The board id.
 * @param stateVector - The store's state vector.
 * @returns The message bytes.
 */
export function encodeSyncStep1(documentName: string, stateVector: Uint8Array): Uint8Array {
  return encodeSyncMessage(documentName, messageYjsSyncStep1, stateVector);
}

/**
 * Encodes sync step 2: what the relay lacks, as one update.
 *
 * @param documentName - The board id.
 * @param update - The store's state minus the relay's state vector.
 * @returns The message bytes.
 */
export function encodeSyncStep2(documentName: string, update: Uint8Array): Uint8Array {
  return encodeSyncMessage(documentName, messageYjsSyncStep2, update);
}

/**
 * Encodes one local update.
 *
 * @param documentName - The board id.
 * @param update - The update (Yjs update format v1).
 * @returns The message bytes.
 */
export function encodeUpdateMessage(documentName: string, update: Uint8Array): Uint8Array {
  return encodeSyncMessage(documentName, messageYjsUpdate, update);
}

/**
 * Encodes an awareness update.
 *
 * @param documentName - The board id.
 * @param update - The encoded awareness update.
 * @returns The message bytes.
 */
export function encodeAwarenessMessage(documentName: string, update: Uint8Array): Uint8Array {
  const encoder = startMessage(documentName, RELAY_MESSAGE_TYPES.awareness);
  encoding.writeVarUint8Array(encoder, update);
  return encoding.toUint8Array(encoder);
}

/**
 * Encodes the answer to a connection-level ping (no document name).
 *
 * @returns The message bytes.
 */
export function encodePong(): Uint8Array {
  return new Uint8Array([RELAY_MESSAGE_TYPES.pong]);
}

/**
 * Reads the payload of a sync message.
 *
 * @param decoder - Positioned after the message type.
 * @returns The message.
 * @throws {RangeError} When the sync message type is unknown.
 */
function readSync(decoder: decoding.Decoder): RelayMessage {
  const syncType = decoding.readVarUint(decoder);
  const payload = decoding.readVarUint8Array(decoder);
  switch (syncType) {
    case messageYjsSyncStep1:
      return { kind: 'sync-step-1', stateVector: payload };
    case messageYjsSyncStep2:
      return { kind: 'sync-step-2', update: payload };
    case messageYjsUpdate:
      return { kind: 'update', update: payload };
    default:
      throw new RangeError(`Unknown sync message type ${String(syncType)}.`);
  }
}

/**
 * Reads the payload of an authentication message.
 *
 * @param decoder - Positioned after the message type.
 * @returns The message.
 * @throws {RangeError} When the authentication message type is unknown.
 */
function readAuth(decoder: decoding.Decoder): RelayMessage {
  const authType = decoding.readVarUint(decoder);
  switch (authType) {
    case AUTH_TOKEN:
      return { kind: 'token-request' };
    case AUTH_PERMISSION_DENIED:
      return { kind: 'permission-denied', reason: decoding.readVarString(decoder) };
    case AUTH_AUTHENTICATED:
      return { kind: 'authenticated', isReadOnly: decoding.readVarString(decoder) === 'readonly' };
    default:
      throw new RangeError(`Unknown authentication message type ${String(authType)}.`);
  }
}

/**
 * Reads a stateless payload: the relay's keepalive, its word on the connection's token, its
 * clock, or anything else, which the client ignores (never a throw, so a stray stateless message cannot
 * drop the connection).
 *
 * @param decoder - Positioned after the message type.
 * @returns The message.
 */
function readStateless(decoder: decoding.Decoder): RelayMessage {
  const payload = decoding.readVarString(decoder);
  if (payload.length > MAX_STATELESS_CHARS) return { kind: 'ignored' };
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return { kind: 'ignored' };
  }
  if (typeof value !== 'object' || value === null) return { kind: 'ignored' };
  const { type, expiresInMs } = value as Record<string, unknown>;
  if (type === 'keepalive') return { kind: 'keepalive' };
  if (type === 'threads-changed') return { kind: 'threads-changed' };
  if (type === 'votes-changed') return { kind: 'votes-changed' };
  if (type === 'reaction') {
    const event = parseReactionEvent(payload);
    return event === undefined ? { kind: 'ignored' } : { kind: 'reaction', event };
  }
  if (type === 'server-time') {
    const answer = parseServerTime(payload);
    return answer === undefined ? { kind: 'ignored' } : { kind: 'server-time', ...answer };
  }
  const isKind = type === 'token-expiry' || type === 'token-refreshed';
  const isDuration =
    typeof expiresInMs === 'number' && Number.isFinite(expiresInMs) && expiresInMs >= 0;
  return isKind && isDuration ? { kind: type, expiresInMs } : { kind: 'ignored' };
}

/**
 * Decodes a message from the relay.
 *
 * @param data - The WebSocket frame.
 * @param documentName - The board id this client opened; other documents' messages are ignored.
 * @returns The message.
 * @throws {RangeError} When a sync or authentication message has an unknown sub-type.
 * @throws {Error} When the frame is truncated (lib0's decoding error).
 */
export function decodeRelayMessage(data: Uint8Array, documentName: string): RelayMessage {
  if (data.length === 1 && data[0] === RELAY_MESSAGE_TYPES.ping) return { kind: 'ping' };
  const decoder = decoding.createDecoder(data);
  if (decoding.readVarString(decoder) !== documentName) return { kind: 'ignored' };
  const type = decoding.readVarUint(decoder);
  switch (type) {
    case RELAY_MESSAGE_TYPES.sync:
      return readSync(decoder);
    case RELAY_MESSAGE_TYPES.awareness:
      return { kind: 'awareness', update: decoding.readVarUint8Array(decoder) };
    case RELAY_MESSAGE_TYPES.auth:
      return readAuth(decoder);
    case RELAY_MESSAGE_TYPES.queryAwareness:
      return { kind: 'query-awareness' };
    case RELAY_MESSAGE_TYPES.syncStatus:
      // The provider reads the flag as a signed varint; for 0 and 1 the bytes are the same.
      return { kind: 'sync-status', isApplied: decoding.readVarInt(decoder) === 1 };
    case RELAY_MESSAGE_TYPES.close:
      return { kind: 'close', reason: decoding.readVarString(decoder) };
    case RELAY_MESSAGE_TYPES.stateless:
      return readStateless(decoder);
    default:
      return { kind: 'ignored' };
  }
}
