import { MAX_TIME_REQUEST_ID } from '@canvas/schema';

import type { PresenceClock } from '../presence/presence-time.js';

// The relay's clock as a client estimates it. Shared timers count down on the relay's
// clock, so two people whose own clocks disagree by minutes still see the same time. The client
// asks the relay for its clock (`time-request`), times the round trip on its own clock, and
// takes the relay's answer as read halfway through it: the offset is `nowMs - (sent + received)
// / 2`, wrong by at most half the round trip. Of the recent samples, the one with the shortest
// round trip wins. Until an answer arrives the offset is zero: the client's own clock.

/** One timed answer of the relay. */
export interface ServerTimeSample {
  /** When the request went, by the client's clock. */
  readonly sentAt: number;
  /** When the answer came, by the client's clock. */
  readonly receivedAt: number;
  /** The relay's clock in the answer. */
  readonly serverNowMs: number;
}

/** An estimate of the relay's clock against the client's. */
export interface ServerOffset {
  /** Add to the client's clock to read the relay's, in ms. */
  readonly offsetMs: number;
  /** How far off it can be, in ms: half the sample's round trip. */
  readonly errorMs: number;
}

/** How many recent samples the estimate is drawn from. */
export const SERVER_TIME_SAMPLES = 8;

/** A round trip longer than this tells too little to use, in ms. */
export const MAX_SERVER_TIME_ROUND_TRIP_MS = 10_000;

/** How many requests may wait for an answer at once; the oldest is forgotten past it. */
const MAX_PENDING = 8;

/**
 * Estimates the relay's clock from timed answers: the sample with the shortest round trip, the
 * relay's clock taken as read halfway through it. Pure.
 *
 * @param samples - Timed answers; those with a negative round trip or one over
 *   {@link MAX_SERVER_TIME_ROUND_TRIP_MS} are ignored.
 * @returns The estimate, or `undefined` when no sample can be used.
 */
export function estimateServerOffset(
  samples: readonly ServerTimeSample[],
): ServerOffset | undefined {
  let best: ServerTimeSample | undefined;
  for (const sample of samples) {
    const roundTrip = sample.receivedAt - sample.sentAt;
    if (!(roundTrip >= 0 && roundTrip <= MAX_SERVER_TIME_ROUND_TRIP_MS)) continue;
    if (best === undefined || roundTrip < best.receivedAt - best.sentAt) best = sample;
  }
  if (best === undefined) return undefined;
  const roundTrip = best.receivedAt - best.sentAt;
  return {
    offsetMs: best.serverNowMs - (best.sentAt + best.receivedAt) / 2,
    errorMs: roundTrip / 2,
  };
}

/**
 * A client's estimate of the relay's clock, fed by the relay connection: it asks with
 * {@link ServerClock.request}'s id and hands each answer to {@link ServerClock.receive}. It
 * outlives connections, so a reconnect keeps the estimate until a better sample replaces it.
 */
export class ServerClock {
  readonly #clock: PresenceClock;
  readonly #pending = new Map<number, number>();
  readonly #listeners = new Set<() => void>();
  #samples: ServerTimeSample[] = [];
  #offset: ServerOffset | undefined;
  #nextId = 0;

  /**
   * Starts with no estimate: the relay's clock reads as the client's until an answer arrives.
   *
   * @param clock - The client's clock; `Date.now` by default.
   */
  constructor(clock: PresenceClock = { now: () => Date.now() }) {
    this.#clock = clock;
  }

  /**
   * The relay's clock now, as estimated: the client's clock plus the offset.
   *
   * @returns ms since the epoch.
   */
  now(): number {
    return this.#clock.now() + (this.#offset?.offsetMs ?? 0);
  }

  /**
   * The current estimate.
   *
   * @returns The offset and its error bound, or `undefined` before the first usable answer.
   */
  get offset(): ServerOffset | undefined {
    return this.#offset;
  }

  /**
   * Notes a request about to be sent, timed by the client's clock.
   *
   * @returns The request's id, to send in the `time-request`.
   */
  request(): number {
    const id = this.#nextId;
    this.#nextId = id === MAX_TIME_REQUEST_ID ? 0 : id + 1;
    this.#pending.set(id, this.#clock.now());
    if (this.#pending.size > MAX_PENDING) {
      const [oldest] = this.#pending.keys();
      if (oldest !== undefined) this.#pending.delete(oldest);
    }
    return id;
  }

  /**
   * Takes the relay's answer to a request: an answer to no pending request (a repeat, an
   * unknown id) is ignored. Listeners are told when the estimate changes.
   *
   * @param id - The answer's id.
   * @param serverNowMs - The relay's clock in the answer.
   */
  receive(id: number, serverNowMs: number): void {
    const sentAt = this.#pending.get(id);
    if (sentAt === undefined) return;
    this.#pending.delete(id);
    const sample = { sentAt, receivedAt: this.#clock.now(), serverNowMs };
    this.#samples = [...this.#samples, sample].slice(-SERVER_TIME_SAMPLES);
    const offset = estimateServerOffset(this.#samples);
    if (offset === undefined || offset.offsetMs === this.#offset?.offsetMs) return;
    this.#offset = offset;
    for (const listener of [...this.#listeners]) listener();
  }

  /**
   * Listens for changes of the estimate.
   *
   * @param listener - Called after each change.
   * @returns A function that stops listening.
   */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}
