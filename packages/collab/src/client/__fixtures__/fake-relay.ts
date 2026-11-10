import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';

import { LAYOUT_GATE_CLOSE_CODE } from '@canvas/document';

import type { CollabSocket, CollabSocketFactory, CollabSocketHandlers } from '../collab-socket.js';
import { RELAY_MESSAGE_TYPES } from '../relay-protocol.js';

/** What kind of message a client sent, as the fake relay logs it. */
export type ReceivedKind =
  'auth' | 'sync-step-1' | 'sync-step-2' | 'update' | 'awareness' | 'other';

/** One frame the fake relay received from a client. */
export interface ReceivedFrame {
  /** The connection it came on, numbered from 1. */
  readonly connection: number;
  /** What it was. */
  readonly kind: ReceivedKind;
  /** Its size in bytes, framing included. */
  readonly size: number;
}

interface FakeConnection {
  readonly id: number;
  readonly handlers: CollabSocketHandlers;
  documentName: string;
  isOpen: boolean;
  isAuthenticated: boolean;
  readonly queued: Uint8Array[];
}

const SYNC_KINDS: readonly ReceivedKind[] = ['sync-step-1', 'sync-step-2', 'update'];

/**
 * Starts a frame from the relay: document name, then message type.
 *
 * @param documentName - The board id.
 * @param type - The message type.
 * @returns The encoder.
 */
function frame(documentName: string, type: number): encoding.Encoder {
  const encoder = encoding.createEncoder();
  encoding.writeVarString(encoder, documentName);
  encoding.writeVarUint(encoder, type);
  return encoder;
}

/**
 * An in-process stand-in for the relay that speaks the Hocuspocus protocol the way
 * `@hocuspocus/server` does (auth first, then step 1 answered with step 1 and step 2, a sync
 * status per applied update, updates and awareness broadcast to every connection including the
 * sender),
 * over a transport that counts every byte. Nothing moves until the test calls
 * {@link FakeRelay.run}, so tests are deterministic.
 */
export class FakeRelay {
  /** The relay's copy of the board. */
  readonly doc = new Y.Doc();
  /** Every frame received from clients, in order. */
  readonly received: ReceivedFrame[] = [];
  /** The board's state vector after each step 2 or update a client sent, in order. */
  readonly appliedStateVectors: Uint8Array[] = [];
  /** Each step 2 or update a client sent, in order, as the relay received it. */
  readonly receivedUpdates: Uint8Array[] = [];
  /**
   * The largest frame a client may send; a larger one closes its connection with 1009, as the
   * relay's frame limit does. Unlimited by default.
   */
  maxFrameBytes = Number.POSITIVE_INFINITY;
  /** When set, every token is refused with this reason. */
  deniedReason: string | undefined;
  /** Tokens refused with a reason each, as a relay refuses an expired token. */
  readonly refusedTokens = new Map<string, string>();
  /** Every token clients authenticated with, in order. */
  readonly receivedTokens: string[] = [];
  /**
   * When set, the relay accepts every token and then closes the connection with this code and
   * reason, as a relay whose auth hook passes but whose document hook refuses.
   */
  closeAfterAuth: { readonly code: number; readonly reason: string } | undefined;
  /** The URL of every connection clients opened, in order. */
  readonly openedUrls: string[] = [];
  /**
   * When set, the layout gate refuses every connection that authenticates: the socket is closed
   * with 4426 and this reason, before anything is sent.
   */
  layoutRefusal: string | undefined;
  /**
   * When set, every connection that authenticates is closed with this code and reason before
   * anything is sent, as the relay closes the waiters of a board whose load failed (1013
   * `storage-unavailable`).
   */
  loadFailure: { readonly code: number; readonly reason: string } | undefined;
  /**
   * When set, each connection is told its token has this long left once it authenticates, and
   * each accepted refresh is answered with it (`token-expiry`, `token-refreshed`).
   */
  announcedExpiryMs: number | undefined;
  /** What the relay does with a `token-refresh`: accept it, close 4401 or 4403, or ignore it. */
  refreshPolicy: 'accept' | 'refuse' | 'access-changed' | 'ignore' = 'accept';
  /** How many keepalives clients answered with. */
  keepaliveAnswers = 0;
  /** Every reaction clients sent, parsed, in order. */
  readonly reactions: unknown[] = [];
  /** Every token clients sent in a `token-refresh`, in order. */
  readonly refreshTokens: string[] = [];
  /** When set, connections are read-only: updates are refused with a negative sync status. */
  isReadOnly = false;
  /** When cleared, new connections fail to open, as when the relay is down. */
  isReachable = true;
  /** When cleared, connections open but the relay never answers, as over a dead network. */
  isResponsive = true;
  #events: (() => void)[] = [];
  readonly #connections = new Set<FakeConnection>();
  #nextConnectionId = 1;

  /** Sets up broadcasting of applied updates to the other connections. */
  constructor() {
    // Hocuspocus 4.7 broadcasts an applied update to every connection of the document,
    // including the one it came from, so clients must not send an echo back.
    this.doc.on('update', (update: Uint8Array) => {
      for (const connection of this.#connections) {
        if (connection.isAuthenticated) {
          const encoder = frame(connection.documentName, RELAY_MESSAGE_TYPES.sync);
          encoding.writeVarUint(encoder, 2);
          encoding.writeVarUint8Array(encoder, update);
          this.#deliver(connection, encoding.toUint8Array(encoder));
        }
      }
    });
  }

  /**
   * The transport to hand the client: each call opens one connection to this relay.
   *
   * @param url - Recorded in {@link FakeRelay.openedUrls}: there is one fake relay.
   * @param handlers - The client's socket handlers.
   * @returns The socket.
   */
  readonly socketFactory: CollabSocketFactory = (url, handlers) => {
    this.openedUrls.push(url);
    const connection: FakeConnection = {
      id: this.#nextConnectionId++,
      handlers,
      documentName: '',
      isOpen: false,
      isAuthenticated: false,
      queued: [],
    };
    const isReachable = this.isReachable;
    this.#events.push(() => {
      if (isReachable) {
        connection.isOpen = true;
        this.#connections.add(connection);
        handlers.onOpen();
      } else {
        handlers.onClose(1006, 'unreachable');
      }
    });
    const socket: CollabSocket = {
      send: (data) => {
        if (!connection.isOpen) return;
        this.#events.push(() => {
          if (data.length > this.maxFrameBytes) this.#close(connection, 1009, 'frame-too-large');
          else this.#receive(connection, data);
        });
      },
      close: () => {
        this.#events.push(() => {
          this.#close(connection, 1000, '');
        });
      },
    };
    return socket;
  };

  /**
   * How many connections are open.
   *
   * @returns The count.
   */
  get openConnectionCount(): number {
    return this.#connections.size;
  }

  /**
   * Delivers every pending event, in order, until nothing is left.
   *
   * @throws {Error} When events keep coming (a feedback loop).
   */
  run(): void {
    for (let step = 0; this.#events.length > 0; step += 1) {
      if (step > 10_000) throw new Error('the fake relay did not settle');
      this.#events.shift()?.();
    }
  }

  /**
   * Closes every connection, abruptly by default (close code 1006), as when the relay process
   * dies.
   *
   * @param code - The close code the clients see.
   * @param reason - The close reason.
   */
  drop(code = 1006, reason = 'dropped'): void {
    for (const connection of [...this.#connections]) this.#close(connection, code, reason);
  }

  /**
   * Sends a frame to every open connection.
   *
   * @param build - Builds the frame for a connection's document name.
   */
  sendToAll(build: (documentName: string) => Uint8Array): void {
    for (const connection of this.#connections) {
      this.#deliver(connection, build(connection.documentName));
    }
  }

  /**
   * The bytes clients sent in sync messages (step 1, step 2, updates) on one connection.
   *
   * @param connection - The connection number.
   * @returns The total, framing included.
   */
  syncBytesOn(connection: number): number {
    return this.received
      .filter((entry) => entry.connection === connection && SYNC_KINDS.includes(entry.kind))
      .reduce((sum, entry) => sum + entry.size, 0);
  }

  #tellExpiry(connection: FakeConnection, type: 'token-expiry' | 'token-refreshed'): void {
    const expiresInMs = this.announcedExpiryMs;
    if (expiresInMs === undefined) return;
    const encoder = frame(connection.documentName, RELAY_MESSAGE_TYPES.stateless);
    encoding.writeVarString(encoder, JSON.stringify({ type, expiresInMs }));
    this.#deliver(connection, encoding.toUint8Array(encoder));
  }

  #deliver(connection: FakeConnection, data: Uint8Array): void {
    this.#events.push(() => {
      if (connection.isOpen) connection.handlers.onMessage(data);
    });
  }

  #close(connection: FakeConnection, code: number, reason: string): void {
    if (!this.#connections.delete(connection) && !connection.isOpen) return;
    connection.isOpen = false;
    connection.handlers.onClose(code, reason);
  }

  #receive(connection: FakeConnection, data: Uint8Array): void {
    if (!this.isResponsive) return;
    if (data.length === 1 && data[0] === RELAY_MESSAGE_TYPES.pong) return;
    const decoder = decoding.createDecoder(data);
    connection.documentName = decoding.readVarString(decoder);
    const type = decoding.readVarUint(decoder);
    const syncType = type === RELAY_MESSAGE_TYPES.sync ? decoding.peekVarUint(decoder) : -1;
    this.received.push({
      connection: connection.id,
      kind: kindOf(type, syncType),
      size: data.length,
    });
    if (type === RELAY_MESSAGE_TYPES.auth) {
      decoding.readVarUint(decoder);
      const token = decoding.readVarString(decoder);
      this.receivedTokens.push(token);
      this.#authenticate(connection, token);
    } else if (!connection.isAuthenticated) {
      connection.queued.push(data);
    } else {
      this.#handle(connection, type, decoder);
    }
  }

  #authenticate(connection: FakeConnection, token: string): void {
    const failure = this.loadFailure;
    if (failure !== undefined) {
      this.#events.push(() => {
        this.#close(connection, failure.code, failure.reason);
      });
      return;
    }
    const refusal = this.layoutRefusal;
    if (refusal !== undefined) {
      this.#events.push(() => {
        this.#close(connection, LAYOUT_GATE_CLOSE_CODE, refusal);
      });
      return;
    }
    const encoder = frame(connection.documentName, RELAY_MESSAGE_TYPES.auth);
    const deniedReason = this.deniedReason ?? this.refusedTokens.get(token);
    if (deniedReason !== undefined) {
      encoding.writeVarUint(encoder, 1);
      encoding.writeVarString(encoder, deniedReason);
      this.#deliver(connection, encoding.toUint8Array(encoder));
      return;
    }
    encoding.writeVarUint(encoder, 2);
    encoding.writeVarString(encoder, this.isReadOnly ? 'readonly' : 'read-write');
    this.#deliver(connection, encoding.toUint8Array(encoder));
    const closing = this.closeAfterAuth;
    if (closing !== undefined) {
      this.#events.push(() => {
        this.#close(connection, closing.code, closing.reason);
      });
      return;
    }
    connection.isAuthenticated = true;
    this.#tellExpiry(connection, 'token-expiry');
    for (const queued of connection.queued.splice(0)) {
      const decoder = decoding.createDecoder(queued);
      decoding.readVarString(decoder);
      this.#handle(connection, decoding.readVarUint(decoder), decoder);
    }
  }

  #handle(connection: FakeConnection, type: number, decoder: decoding.Decoder): void {
    const { documentName } = connection;
    if (type === RELAY_MESSAGE_TYPES.awareness) {
      const update = decoding.readVarUint8Array(decoder);
      this.sendToAll((name) => {
        const encoder = frame(name, RELAY_MESSAGE_TYPES.awareness);
        encoding.writeVarUint8Array(encoder, update);
        return encoding.toUint8Array(encoder);
      });
      return;
    }
    if (type === RELAY_MESSAGE_TYPES.stateless) {
      const message = JSON.parse(decoding.readVarString(decoder)) as {
        type: string;
        token: string;
      };
      if (message.type === 'keepalive') {
        this.keepaliveAnswers += 1;
        return;
      }
      if (message.type === 'reaction') {
        this.reactions.push(message);
        return;
      }
      const { token } = message;
      this.refreshTokens.push(token);
      if (this.refreshPolicy === 'accept') this.#tellExpiry(connection, 'token-refreshed');
      else if (this.refreshPolicy === 'refuse')
        this.#close(connection, 4401, 'token-refresh-refused');
      else if (this.refreshPolicy === 'access-changed')
        this.#close(connection, 4403, 'access-changed');
      return;
    }
    if (type !== RELAY_MESSAGE_TYPES.sync) return;
    const syncType = decoding.readVarUint(decoder);
    const payload = decoding.readVarUint8Array(decoder);
    if (syncType === 0) {
      const stepOne = frame(documentName, RELAY_MESSAGE_TYPES.sync);
      encoding.writeVarUint(stepOne, 0);
      encoding.writeVarUint8Array(stepOne, Y.encodeStateVector(this.doc));
      this.#deliver(connection, encoding.toUint8Array(stepOne));
      const stepTwo = frame(documentName, RELAY_MESSAGE_TYPES.sync);
      encoding.writeVarUint(stepTwo, 1);
      encoding.writeVarUint8Array(stepTwo, Y.encodeStateAsUpdate(this.doc, payload));
      this.#deliver(connection, encoding.toUint8Array(stepTwo));
      return;
    }
    this.receivedUpdates.push(payload);
    if (!this.isReadOnly) Y.applyUpdate(this.doc, payload, connection);
    this.appliedStateVectors.push(Y.encodeStateVector(this.doc));
    const status = frame(documentName, RELAY_MESSAGE_TYPES.syncStatus);
    encoding.writeVarUint(status, this.isReadOnly ? 0 : 1);
    this.#deliver(connection, encoding.toUint8Array(status));
  }
}

/**
 * Names a received message.
 *
 * @param type - The message type.
 * @param syncType - The sync sub-type, for sync messages.
 * @returns The kind.
 */
function kindOf(type: number, syncType: number): ReceivedKind {
  if (type === RELAY_MESSAGE_TYPES.auth) return 'auth';
  if (type === RELAY_MESSAGE_TYPES.awareness) return 'awareness';
  if (type !== RELAY_MESSAGE_TYPES.sync) return 'other';
  return SYNC_KINDS[syncType] ?? 'other';
}
