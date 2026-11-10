import { describe, expect, it } from 'vitest';

import { boardTimerSchema, timerRemainingMs, type BoardTimer } from '@canvas/schema';

import {
  estimateServerOffset,
  MAX_SERVER_TIME_ROUND_TRIP_MS,
  SERVER_TIME_SAMPLES,
  ServerClock,
} from './server-clock.js';

const SERVER_T0 = 1_770_000_000_000;

/** A client clock the test moves. */
class TestClock {
  at: number;

  constructor(at: number) {
    this.at = at;
  }

  now(): number {
    return this.at;
  }
}

/**
 * One request and its answer over a link with the given one-way delays, the relay's clock
 * `serverAt` when it answers.
 *
 * @param server - The client's estimate.
 * @param clock - The client's clock.
 * @param serverAt - The relay's clock when it answers.
 * @param up - The request's delay, ms.
 * @param down - The answer's delay, ms.
 */
function exchange(
  server: ServerClock,
  clock: TestClock,
  serverAt: number,
  up: number,
  down: number,
): void {
  const id = server.request();
  clock.at += up;
  clock.at += down;
  server.receive(id, serverAt);
}

describe('estimateServerOffset', () => {
  it('reads the relay clock halfway through the shortest round trip', () => {
    expect(
      estimateServerOffset([
        { sentAt: 1000, receivedAt: 1400, serverNowMs: 5300 },
        { sentAt: 2000, receivedAt: 2040, serverNowMs: 6025 },
      ]),
    ).toEqual({ offsetMs: 4005, errorMs: 20 });
  });

  it('ignores negative and overlong round trips, and has nothing without a usable sample', () => {
    expect(estimateServerOffset([])).toBeUndefined();
    expect(
      estimateServerOffset([
        { sentAt: 10, receivedAt: 5, serverNowMs: 0 },
        { sentAt: 0, receivedAt: MAX_SERVER_TIME_ROUND_TRIP_MS + 1, serverNowMs: 0 },
      ]),
    ).toBeUndefined();
  });

  it('is wrong by at most half the round trip, however the delay splits', () => {
    for (const [up, down] of [
      [0, 200],
      [200, 0],
      [37, 163],
    ] as const) {
      const sentAt = 50_000;
      const trueOffset = SERVER_T0 - sentAt;
      const offset = estimateServerOffset([
        { sentAt, receivedAt: sentAt + up + down, serverNowMs: sentAt + up + trueOffset },
      ]);
      expect(Math.abs((offset?.offsetMs ?? 0) - trueOffset)).toBeLessThanOrEqual(100);
      expect(offset?.errorMs).toBe(100);
    }
  });
});

describe('ServerClock', () => {
  it('reads the client clock until an answer arrives, then the relay clock', () => {
    const clock = new TestClock(1000);
    const server = new ServerClock(clock);
    expect(server.now()).toBe(1000);
    expect(server.offset).toBeUndefined();
    exchange(server, clock, SERVER_T0, 30, 30);
    expect(server.now()).toBe(SERVER_T0 + 30);
    expect(server.offset).toEqual({ offsetMs: SERVER_T0 - 1030, errorMs: 30 });
  });

  it('keeps the best of the recent samples and tells listeners when it changes', () => {
    const clock = new TestClock(0);
    const server = new ServerClock(clock);
    let changes = 0;
    const stop = server.subscribe(() => (changes += 1));
    exchange(server, clock, SERVER_T0, 200, 200);
    exchange(server, clock, SERVER_T0 + 410, 5, 5);
    expect(server.offset?.errorMs).toBe(5);
    // A slower sample later does not replace it.
    exchange(server, clock, SERVER_T0 + 1000, 400, 0);
    expect(server.offset?.errorMs).toBe(5);
    expect(changes).toBe(2);
    stop();
    // Once it ages out of the window, the best remaining sample wins.
    for (let index = 0; index < SERVER_TIME_SAMPLES; index += 1)
      exchange(server, clock, SERVER_T0 + 2000 + index * 100, 50, 50);
    expect(server.offset?.errorMs).toBe(50);
    expect(changes).toBe(2);
  });

  it('ignores answers to no pending request', () => {
    const clock = new TestClock(0);
    const server = new ServerClock(clock);
    const id = server.request();
    server.receive(id + 1, SERVER_T0);
    expect(server.offset).toBeUndefined();
    server.receive(id, SERVER_T0);
    server.receive(id, SERVER_T0 + 999_999);
    expect(server.now()).toBe(SERVER_T0);
  });

  it('forgets the oldest of too many unanswered requests', () => {
    const clock = new TestClock(0);
    const server = new ServerClock(clock);
    const first = server.request();
    for (let index = 0; index < 8; index += 1) server.request();
    server.receive(first, SERVER_T0);
    expect(server.offset).toBeUndefined();
  });

  it('shows two clients whose clocks differ by minutes the same timer within 250 ms', () => {
    // The relay's clock is SERVER_T0 at the start; Ada's runs 5 min fast, Bob's 3 min slow.
    const ada = new TestClock(SERVER_T0 + 300_000);
    const bob = new TestClock(SERVER_T0 - 180_000);
    const adaServer = new ServerClock(ada);
    const bobServer = new ServerClock(bob);
    // Ada's link is quick and lopsided, Bob's slow and lopsided the other way.
    exchange(adaServer, ada, SERVER_T0 + 20, 20, 60);
    exchange(bobServer, bob, SERVER_T0 + 250, 250, 50);
    // Both exchanges began at the same moment; Ada's ended 80 ms in, Bob's 300 ms in. Bring Ada to
    // the same moment, then both clocks move on together with the relay's; Ada starts a timer.
    ada.at += 220;
    const timer: BoardTimer = boardTimerSchema.parse({
      status: 'running',
      durationMs: 60_000,
      remainingMs: 60_000,
      startedAt: Math.floor(adaServer.now()),
      sectionId: null,
      updatedBy: 'user:ada',
    });
    for (const elapsed of [0, 1_234, 30_000, 59_900]) {
      const adaLeft = timerRemainingMs(timer, adaServer.now() + elapsed);
      const bobLeft = timerRemainingMs(timer, bobServer.now() + elapsed);
      expect(Math.abs(adaLeft - bobLeft)).toBeLessThanOrEqual(250);
    }
    // Against their own clocks they would disagree by the whole skew.
    expect(Math.abs(ada.now() - bob.now())).toBeGreaterThan(400_000);
  });
});
