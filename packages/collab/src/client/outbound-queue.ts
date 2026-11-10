/**
 * One local update not yet acknowledged: its bytes, or `undefined` once they need not be kept (a
 * read-only connection, whose updates the relay never applies).
 */
type PendingUpdate = Uint8Array | undefined;

/** One message in flight: the local updates the relay has acknowledged once it acknowledges it. */
interface InFlightMessage {
  /** The updates, oldest first; empty for every chunk of a split message but its last. */
  readonly updates: readonly PendingUpdate[];
}

/**
 * The client's account of local updates the relay has not acknowledged, in the
 * order they were made, with their bytes. A held update reaches the
 * relay in the sync step 2 of the next handshake, which carries exactly what the relay lacks; an
 * update sent live travels as its own message (in chunks when large). The relay acknowledges
 * each message with a sync status, in the order received. The bytes stay until the relay
 * acknowledges them, so a reconnect can replay the unsent transactions whole, in order
 * (`planStoredReplay`), instead of cutting the difference by struct ranges: they cost as much
 * memory as the unsent edits themselves. On a read-only connection (a viewer, a commenter) the
 * relay never applies them, so their bytes are not kept ({@link OutboundQueue.keepBytes}); they
 * are still counted as pending.
 */
export class OutboundQueue {
  /** Local updates waiting for the next step 2, oldest first. */
  #held: PendingUpdate[] = [];
  #isKeepingBytes = true;
  /** Sent, unacknowledged messages, oldest first. */
  #inFlight: InFlightMessage[] = [];

  /**
   * Local updates not yet acknowledged, held or in flight.
   *
   * @returns The count.
   */
  get pendingCount(): number {
    return this.#inFlight.reduce((sum, message) => sum + message.updates.length, this.#held.length);
  }

  /**
   * Whether the relay has acknowledged everything and nothing is held.
   *
   * @returns `true` when nothing is pending and no message awaits acknowledgement.
   */
  get isSettled(): boolean {
    return this.#held.length === 0 && this.#inFlight.length === 0;
  }

  /**
   * The local updates the relay has not acknowledged, in the order they were made: those in
   * flight, then those held.
   *
   * @returns The updates (Yjs update format v1), oldest first.
   */
  get unacknowledged(): readonly Uint8Array[] {
    return this.#pending().filter((update) => update !== undefined);
  }

  /**
   * Whether the bytes of local updates are kept for a replay: not while the connection is
   * read-only, since the relay never applies its updates; turning it off drops the bytes kept so
   * far (the updates stay counted). A replay can then not cover them, and the next writable
   * connection sends them by the next source (the cache's log, or struct ranges).
   *
   * @param isKeeping - Whether to keep them.
   */
  keepBytes(isKeeping: boolean): void {
    this.#isKeepingBytes = isKeeping;
    if (isKeeping) return;
    this.#held = this.#held.map(() => undefined);
    this.#inFlight = this.#inFlight.map(({ updates }) => ({
      updates: updates.map(() => undefined),
    }));
  }

  /**
   * Records a local update made while the connection cannot carry it.
   *
   * @param update - The update's bytes; kept until acknowledged.
   */
  hold(update: Uint8Array): void {
    this.#held.push(this.#isKeepingBytes ? update : undefined);
  }

  /**
   * Records that a step 2 went out, carrying every held update, in `messageCount` messages (a
   * large one is sent in chunks): the held updates count as acknowledged with the last.
   *
   * @param messageCount - How many messages carried it; default 1.
   * @returns How many held updates it carries.
   */
  sendHeld(messageCount = 1): number {
    const updates = this.#held;
    this.#held = [];
    this.#pushMessages(updates, messageCount);
    return updates.length;
  }

  /**
   * Records that one local update went out live, in `messageCount` messages (chunks); it counts
   * as acknowledged with the last.
   *
   * @param update - The update's bytes.
   * @param messageCount - How many messages carried it; default 1.
   */
  sendOne(update: Uint8Array, messageCount = 1): void {
    this.#pushMessages([this.#isKeepingBytes ? update : undefined], messageCount);
  }

  /** Records the relay's acknowledgement of the oldest message in flight. */
  acknowledge(): void {
    this.#inFlight.shift();
  }

  /**
   * Holds every unacknowledged update again after the connection dropped: the relay may or may
   * not have applied them, and the next step 2 carries whatever it lacks.
   */
  requeueInFlight(): void {
    this.#held = this.#pending();
    this.#inFlight = [];
  }

  /**
   * Every pending update, in flight then held, oldest first.
   *
   * @returns The updates; `undefined` where the bytes were not kept.
   */
  #pending(): PendingUpdate[] {
    return [...this.#inFlight.flatMap((message) => message.updates), ...this.#held];
  }

  /**
   * Records messages in flight that together carry `updates`, on the last of them.
   *
   * @param updates - The updates they carry.
   * @param messageCount - How many messages; at least one is recorded.
   */
  #pushMessages(updates: readonly PendingUpdate[], messageCount: number): void {
    for (let index = 1; index < messageCount; index += 1) this.#inFlight.push({ updates: [] });
    this.#inFlight.push({ updates });
  }
}
