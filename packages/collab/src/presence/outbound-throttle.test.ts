import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PRESENCE_RATE_HZ,
  decideOutbound,
  presenceIntervalMs,
} from './outbound-throttle.js';

describe('presenceIntervalMs', () => {
  it('turns the rate into the minimum spacing between outbound updates', () => {
    expect(presenceIntervalMs(DEFAULT_PRESENCE_RATE_HZ)).toBe(40);
    expect(presenceIntervalMs(20)).toBe(50);
    expect(presenceIntervalMs(30)).toBeCloseTo(33.33, 2);
  });

  it('rejects rates outside 20 to 30 Hz, the range remote interpolation is tuned for', () => {
    expect(() => presenceIntervalMs(19)).toThrow(RangeError);
    expect(() => presenceIntervalMs(31)).toThrow(RangeError);
    expect(() => presenceIntervalMs(Number.NaN)).toThrow(RangeError);
  });
});

describe('decideOutbound', () => {
  it('sends the first update at once', () => {
    expect(decideOutbound({ lastSentAtMs: undefined, isFlushPending: false }, 0, 40)).toEqual({
      kind: 'send-now',
    });
  });

  it('sends at once when a full interval has passed since the last send', () => {
    expect(decideOutbound({ lastSentAtMs: 100, isFlushPending: false }, 140, 40)).toEqual({
      kind: 'send-now',
    });
  });

  it('defers an update inside the interval to a trailing flush at the interval end', () => {
    expect(decideOutbound({ lastSentAtMs: 100, isFlushPending: false }, 115, 40)).toEqual({
      kind: 'flush-later',
      delayMs: 25,
    });
  });

  it('folds an update into a trailing flush that is already pending', () => {
    expect(decideOutbound({ lastSentAtMs: 100, isFlushPending: true }, 130, 40)).toEqual({
      kind: 'already-pending',
    });
  });
});
