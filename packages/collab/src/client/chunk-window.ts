/**
 * The most bytes of sync messages (step 2 chunks and live updates) one connection leaves
 * unacknowledged by the relay (4 MiB); a single message larger than that (one
 * transaction of up to `SINGLE_TRANSACTION_BYTES`) goes alone, once nothing else is in flight.
 * So an honest client never has more than 4 MiB, or one transaction of at most 7 MiB, queued on
 * its relay connection, whatever the size of its reconnect.
 */
export const MAX_UNACKNOWLEDGED_BYTES = 4 * 1024 * 1024;

/**
 * Paces one connection's sync messages: at most {@link MAX_UNACKNOWLEDGED_BYTES} sent
 * and not yet acknowledged, or one larger message alone; the rest wait, in order, and go as the
 * relay acknowledges earlier ones. The acknowledgement is the sync status Hocuspocus sends for
 * every sync step 2 and update it handles (applied or refused as read-only), the one
 * `@hocuspocus/provider` counts its unsynced changes by; the relay handles a connection's
 * messages one at a time, in order. No timer: the window moves only when an acknowledgement
 * arrives.
 */
export class ChunkWindow {
  readonly #send: (frame: Uint8Array) => void;
  readonly #limit: number;
  readonly #waiting: Uint8Array[] = [];
  /** The sizes of the messages in flight, oldest first. */
  readonly #inFlight: number[] = [];
  #inFlightBytes = 0;

  /**
   * Paces frames onto a socket.
   *
   * @param send - Sends a frame on the socket.
   * @param limit - The most unacknowledged bytes; default {@link MAX_UNACKNOWLEDGED_BYTES}.
   */
  constructor(send: (frame: Uint8Array) => void, limit = MAX_UNACKNOWLEDGED_BYTES) {
    this.#send = send;
    this.#limit = limit;
  }

  /**
   * Sends a sync message now if the window has room, else after earlier ones are acknowledged.
   *
   * @param frame - The encoded message.
   */
  push(frame: Uint8Array): void {
    this.#waiting.push(frame);
    this.#flush();
  }

  /** Records the relay's acknowledgement of the oldest unacknowledged message, and sends on. */
  acknowledge(): void {
    this.#inFlightBytes -= this.#inFlight.shift() ?? 0;
    this.#flush();
  }

  /** Sends waiting messages while the window has room; one alone always fits. */
  #flush(): void {
    for (let frame = this.#waiting.at(0); frame !== undefined; frame = this.#waiting.at(0)) {
      const isEmpty = this.#inFlight.length === 0;
      if (!isEmpty && this.#inFlightBytes + frame.byteLength > this.#limit) return;
      this.#waiting.shift();
      this.#inFlight.push(frame.byteLength);
      this.#inFlightBytes += frame.byteLength;
      this.#send(frame);
    }
  }
}
