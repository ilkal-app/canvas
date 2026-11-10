import { describe, expect, it } from 'vitest';

import { MAX_TIME_REQUEST_ID } from '@canvas/schema';

import { MAX_SERVER_TIME_ROUND_TRIP_MS, ServerClock } from './server-clock.js';

describe('server clock acceptance: interrupted exchanges', () => {
  it('ignores unknown and evicted answers while preserving the last estimate through reconnect', () => {
    let now = 1000;
    const clock = new ServerClock({ now: () => now });
    const initial = clock.request();
    now += 20;
    clock.receive(initial, 10_010);
    const estimate = clock.offset;
    expect(estimate).toEqual({ offsetMs: 9000, errorMs: 10 });
    const stale = clock.request();
    for (let index = 0; index < 8; index += 1) clock.request();
    clock.receive(stale, 1_000_000);
    clock.receive(MAX_TIME_REQUEST_ID, 1_000_000);
    clock.receive(initial, 1_000_000);
    expect(clock.offset).toEqual(estimate);
    now += 1000;
    expect(clock.now()).toBe(now + 9000);
  });

  it('rejects over-cap round trips and uses a subsequent valid answer', () => {
    let now = 0;
    const clock = new ServerClock({ now: () => now });
    const tooLate = clock.request();
    now = MAX_SERVER_TIME_ROUND_TRIP_MS + 1;
    clock.receive(tooLate, 20_000);
    expect(clock.offset).toBeUndefined();
    const valid = clock.request();
    now += 10;
    clock.receive(valid, 30_000);
    expect(clock.offset).toEqual({
      offsetMs: 30_000 - (MAX_SERVER_TIME_ROUND_TRIP_MS + 6),
      errorMs: 5,
    });
  });
});
