import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { OUTBOUND_CHUNK_BYTES, splitUpdate } from '../chunking/split-update.js';
import { planStoredReplay, type StoredReplay } from '../chunking/stored-replay.js';
import { transactionChunks } from '../chunking/transaction-chunks.js';

import { ChunkWindow } from './chunk-window.js';
import { InboundHold } from './inbound-hold.js';
import type { RelayConnectionHost } from './relay-connection-host.js';
import {
  decodeRelayMessage,
  encodeAuthMessage,
  encodeAwarenessMessage,
  encodePong,
  encodeSyncStep1,
  encodeSyncStep2,
  encodeUpdateMessage,
  RELAY_AWARENESS_ORIGIN,
} from './relay-protocol.js';
import { askServerTime, receiveStateless } from './relay-stateless.js';
import { hasReleasedClocks } from './released-clocks.js';

export type { RelayConnectionHost } from './relay-connection-host.js';

/**
 * One open connection's side of the relay protocol: the
 * Hocuspocus handshake over a `DocumentStore`, then live updates and awareness. The handshake is the resync: the client sends its state vector and
 * receives only what it lacks; the relay sends its state vector and receives, in a step 2,
 * only what it lacks, which includes every edit made offline. Local updates made before that
 * step 2 goes out are held (they travel inside it); later ones travel live, one message each.
 *
 * The unit of sending is the transaction. A step 2 within {@link OUTBOUND_CHUNK_BYTES}
 * goes as one message. A larger one goes as several step 2 messages that replay the unsent
 * transactions whole and in order (`planStoredReplay`), merged up to the chunk size: those the
 * queue holds in memory (this session's unacknowledged updates), else the cache's log (unsent
 * work from before a reload, which the cache keeps uncompacted until the relay acknowledges it).
 * A transaction larger than the chunk goes whole, alone, up to `SINGLE_TRANSACTION_BYTES`
 * (7 MiB), live or replayed. Only these are split by struct ranges (`splitUpdate`), which can
 * show peers part of a transaction and is reported once: a transaction above 7 MiB, and a step 2
 * no replay covers (a cache an older build compacted with unsent work in it, an unreadable log, a
 * cache without `readUpdates`). At most `MAX_UNACKNOWLEDGED_BYTES` (4 MiB) of sync messages, or
 * one larger message alone, are unacknowledged at once (`ChunkWindow`); the relay applies and
 * acknowledges each in order. While a replay reads the log, local updates are held, and the
 * replay's last messages carry them.
 */
export class RelayConnection {
  readonly #host: RelayConnectionHost;
  readonly #send: (data: Uint8Array) => void;
  readonly #window: ChunkWindow;
  #isAuthenticated = false;
  #isLive = false;
  #isSynced = false;
  #isReadOnly = true;
  #isReplaying = false;
  #isDisposed = false;
  /** Initial outbound chunks still awaiting acceptance; zero acknowledges the write side. */
  #initialMessages: number | undefined;
  #hasRefusedInitialSync = false;
  /** Relayed document bytes held while a stepped run holds the store. */
  readonly #hold: InboundHold;
  /** Step 1 requests not yet answered, oldest first (answered in order; a resync holds). */
  readonly #unanswered: ('initial' | 'resync')[] = [];

  /**
   * Prepares a connection over an open socket; {@link RelayConnection.start} opens the
   * handshake.
   *
   * @param host - The owning client.
   * @param send - Sends a frame on the socket.
   */
  constructor(host: RelayConnectionHost, send: (data: Uint8Array) => void) {
    this.#host = host;
    this.#send = send;
    this.#window = new ChunkWindow(send);
    this.#hold = new InboundHold(host.store, {
      apply: (update, isStepTwo) => {
        this.#receiveUpdate(update, isStepTwo);
      },
      onError: (error) => {
        (host.onReceiveError ?? host.reportError)(error);
      },
      resync: () => {
        this.#unanswered.push('resync');
        this.#send(encodeSyncStep1(host.documentName, host.store.encodeStateVector()));
      },
      // A dropped answer settles its request; the newer resync covers what it carried.
      onDroppedStepTwos: (count) => {
        this.#unanswered.splice(0, count);
      },
    });
  }

  /**
   * Whether relayed document bytes wait for a stepped run to end, or were dropped past the bound
   * and their resync's answer has not been applied: until then nothing counts as synced.
   *
   * @returns `true` while any are held.
   */
  get hasHeldInbound(): boolean {
    return this.#hold.isHolding || this.#hold.isOverflowed || this.#unanswered.includes('resync');
  }

  /**
   * Whether the relay has accepted this connection's token.
   *
   * @returns Whether authenticated frame limits apply.
   */
  get isAuthenticated(): boolean {
    return this.#isAuthenticated;
  }

  /**
   * Whether local updates travel live: the step 2 of this connection has gone out.
   *
   * @returns `true` once the client has answered the relay's state vector.
   */
  get isLive(): boolean {
    return this.#isLive;
  }

  /**
   * Whether inbound sync arrived and every initial outbound chunk was accepted. Read-only
   * connections need no write acceptance; a writer's negative initial acknowledgement never qualifies.
   *
   * @returns Whether this connection has completed a successful handshake in both directions.
   */
  get isSyncAcknowledged(): boolean {
    return (
      this.#isSynced &&
      (this.#isReadOnly || (this.#initialMessages === 0 && !this.#hasRefusedInitialSync))
    );
  }

  /**
   * Opens the handshake with only the token. Sync and awareness wait for acceptance because
   * a large board's state vector can exceed the relay's smaller pre-authentication frame cap.
   */
  start(): void {
    const { documentName, token } = this.#host;
    this.#send(encodeAuthMessage(documentName, token));
  }

  /**
   * Sends one local update (one transaction) live: whole up to `SINGLE_TRANSACTION_BYTES`, else
   * split by struct ranges, which is reported.
   *
   * @param update - The store's update.
   */
  sendUpdate(update: Uint8Array): void {
    const { chunks, isCut } = transactionChunks(update);
    if (isCut) this.#host.onStructRangeSplit();
    for (const chunk of chunks) {
      this.#window.push(encodeUpdateMessage(this.#host.documentName, chunk));
    }
    this.#host.queue.sendOne(update, chunks.length);
  }

  /** Stops the connection's protocol for good: a replay still reading the log sends nothing. */
  dispose(): void {
    this.#isDisposed = true;
    this.#hold.dispose();
  }

  /**
   * Sends awareness states after token acceptance. Earlier changes stay in awareness and are
   * sent with its current local state when the handshake continues.
   *
   * @param clients - The awareness client ids whose states to send.
   */
  sendAwareness(clients: readonly number[]): void {
    if (!this.#isAuthenticated) return;
    const { documentName, awareness } = this.#host;
    this.#send(
      encodeAwarenessMessage(documentName, encodeAwarenessUpdate(awareness, [...clients])),
    );
  }

  /**
   * Handles one frame from the relay.
   *
   * @param data - The frame.
   * @throws {Error} When the frame cannot be decoded, or the store refuses a relayed update;
   *   the client then drops the connection and resyncs on the next one.
   */
  receive(data: Uint8Array): void {
    const host = this.#host;
    const message = decodeRelayMessage(data, host.documentName);
    switch (message.kind) {
      case 'ping':
        this.#send(encodePong());
        return;
      case 'token-request':
        this.#send(encodeAuthMessage(host.documentName, host.token));
        return;
      case 'authenticated':
        host.syncTimer?.markAuthenticated();
        this.#isReadOnly = message.isReadOnly;
        // A writer that lost write access publishes no more parts of a run.
        if (message.isReadOnly) this.#hold.requestStop('revoked');
        host.onAuthenticated(message.isReadOnly);
        if (!this.#isAuthenticated) {
          this.#isAuthenticated = true;
          askServerTime(host, this.#send);
          // The state vector is read once the store is idle, after anything held before it.
          if (this.#hold.shouldWait) {
            this.#hold.holdAction(() => {
              this.#openSync();
            });
          } else this.#openSync();
        }
        return;
      case 'permission-denied':
        host.onRejected(message.reason);
        return;
      case 'sync-step-1':
        this.#answerStateVector(message.stateVector);
        return;
      case 'sync-step-2':
        host.syncTimer?.markStepTwo();
        this.#receiveOrHold(message.update, true);
        return;
      case 'update':
        this.#receiveOrHold(message.update, false);
        return;
      case 'awareness':
        applyAwarenessUpdate(host.awareness, message.update, RELAY_AWARENESS_ORIGIN);
        return;
      case 'query-awareness':
        this.sendAwareness([...host.awareness.getStates().keys()]);
        return;
      case 'sync-status':
        if (this.#initialMessages !== undefined && this.#initialMessages > 0) {
          this.#initialMessages -= 1;
          if (!message.isApplied) this.#hasRefusedInitialSync = true;
        }
        if (message.isApplied) host.queue.acknowledge();
        this.#window.acknowledge();
        host.onProgress();
        return;
      case 'close':
        host.onClosedByRelay();
        return;
      case 'keepalive':
      case 'threads-changed':
      case 'votes-changed':
      case 'server-time':
      case 'reaction':
      case 'token-expiry':
      case 'token-refreshed':
        receiveStateless(message, host, this.#send, this.#isAuthenticated);
        return;
      case 'ignored':
        return;
    }
  }

  /** Sends the handshake's state vector, and this client's presence once accepted. */
  #openSync(): void {
    const host = this.#host;
    this.#unanswered.push('initial');
    this.#send(encodeSyncStep1(host.documentName, host.store.encodeStateVector()));
    if (host.awareness.getLocalState() !== null) this.sendAwareness([host.awareness.clientID]);
  }

  /**
   * Applies a relayed update now, or holds it while a stepped run holds the store.
   *
   * @param update - The update bytes.
   * @param isStepTwo - Whether it is the relay's sync step 2.
   */
  #receiveOrHold(update: Uint8Array, isStepTwo: boolean): void {
    if (this.#hold.shouldWait) this.#hold.holdUpdate(update, isStepTwo);
    else this.#receiveUpdate(update, isStepTwo);
  }

  /**
   * Answers the relay's state vector with integrated history, carrying every held local
   * update; from here on local updates travel live. A difference within one chunk goes at once,
   * as one step 2. A larger one replays the unacknowledged updates in memory when they cover it;
   * else the cache's log, read first (local updates are held until the replay is sent); else it
   * is split by struct ranges.
   *
   * @param stateVector - The relay's state vector.
   */
  #answerStateVector(stateVector: Uint8Array): void {
    if (this.#isReplaying) return;
    const { store, queue, readStoredUpdates } = this.#host;
    const whole = store.encodeSyncState(stateVector);
    if (whole.byteLength <= OUTBOUND_CHUNK_BYTES) {
      this.#sendStepTwo([whole]);
      return;
    }
    const localStateVector = store.encodeStateVector();
    const fromMemory = planStoredReplay(queue.unacknowledged, stateVector, localStateVector);
    if (fromMemory !== undefined) {
      this.#sendReplay(fromMemory);
    } else if (readStoredUpdates === undefined) {
      this.#sendStructRanges(whole);
    } else {
      this.#isReplaying = true;
      void this.#answerFromLog(stateVector, localStateVector, readStoredUpdates).catch(
        this.#host.reportError,
      );
    }
  }

  /**
   * Answers the relay's state vector by replaying the cache's log; when it cannot cover the
   * store, or cannot be read (reported), the whole difference split by struct ranges.
   *
   * @param stateVector - The relay's state vector.
   * @param localStateVector - The store's state vector when the relay asked.
   * @param readStoredUpdates - Reads the cache's log.
   */
  async #answerFromLog(
    stateVector: Uint8Array,
    localStateVector: Uint8Array,
    readStoredUpdates: () => Promise<readonly Uint8Array[]>,
  ): Promise<void> {
    let replay: StoredReplay | undefined;
    try {
      replay = planStoredReplay(await readStoredUpdates(), stateVector, localStateVector);
    } catch (error: unknown) {
      this.#host.reportError(error);
    }
    if (this.#isDisposed) return;
    this.#isReplaying = false;
    if (replay === undefined) this.#sendStructRanges(this.#host.store.encodeSyncState(stateVector));
    else this.#sendReplay(replay);
  }

  /**
   * Sends a replay: its chunks, then what the store holds beyond them (edits made while the log
   * was read) and the store's delete set.
   *
   * @param replay - The replay.
   */
  #sendReplay(replay: StoredReplay): void {
    const covered = Y.encodeStateVector(new Map(replay.coveredStateVector));
    const rest = transactionChunks(this.#host.store.encodeSyncState(covered));
    if (replay.isCut || rest.isCut) this.#host.onStructRangeSplit();
    this.#sendStepTwo([...replay.chunks, ...rest.chunks]);
  }

  /**
   * Sends a difference no replay covers split by struct ranges, and reports it.
   *
   * @param whole - The difference.
   */
  #sendStructRanges(whole: Uint8Array): void {
    this.#host.onStructRangeSplit();
    this.#sendStepTwo(splitUpdate(whole));
  }

  /**
   * Sends a step 2 in one or more messages, paced by the window, carrying every held local
   * update; from here on local updates travel live.
   *
   * @param chunks - The step 2's updates, in order.
   */
  #sendStepTwo(chunks: readonly Uint8Array[]): void {
    const { documentName, queue } = this.#host;
    this.#initialMessages ??= chunks.length;
    for (const chunk of chunks) this.#window.push(encodeSyncStep2(documentName, chunk));
    queue.sendHeld(chunks.length);
    this.#isLive = true;
  }

  /**
   * Applies a relayed update; the first step 2 after authentication completes the sync.
   *
   * @param update - The update bytes.
   * @param isStepTwo - Whether it is the relay's answer to the client's state vector.
   */
  #receiveUpdate(update: Uint8Array, isStepTwo: boolean): void {
    const { store } = this.#host;
    // A step 2 answers the oldest step 1; a resync's brings back what an overflow dropped.
    if (isStepTwo) this.#unanswered.shift();
    const before = store.hasPendingStructs ? store.encodeStateVector() : undefined;
    this.#host.applyRemoteUpdate(update);
    // A dependency can release cached content absent from the incoming update. Ordinary
    // peer traffic must not trigger differential encoding or add an acknowledgement debt.
    if (
      before !== undefined &&
      this.#isLive &&
      !this.#isReadOnly &&
      hasReleasedClocks(before, store.encodeStateVector(), update)
    ) {
      this.sendUpdate(store.encodeSyncState(before));
    }
    if (isStepTwo && this.#isAuthenticated && !this.#isSynced) {
      this.#isSynced = true;
      this.#host.onSynced();
    } else {
      this.#host.onProgress();
    }
  }
}
