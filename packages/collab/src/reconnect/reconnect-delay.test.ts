import { describe, expect, it } from 'vitest';

import {
  computeReconnectDelay,
  DEFAULT_RECONNECT_BACKOFF,
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_JITTER_RATIO,
  RECONNECT_MAX_DELAY_MS,
} from './reconnect-delay.js';

describe('computeReconnectDelay', () => {
  it('waits the base delay before the first attempt', () => {
    expect(computeReconnectDelay(0)).toBe(RECONNECT_BASE_DELAY_MS);
  });

  it('doubles the wait on every further attempt', () => {
    expect([1, 2, 3].map((attempt) => computeReconnectDelay(attempt))).toEqual([500, 1000, 2000]);
  });

  it('never waits longer than the maximum delay, however many attempts failed', () => {
    expect(computeReconnectDelay(6)).toBe(RECONNECT_MAX_DELAY_MS);
    expect(computeReconnectDelay(1000)).toBe(RECONNECT_MAX_DELAY_MS);
  });

  it('rejects negative and fractional attempt numbers', () => {
    expect(() => computeReconnectDelay(-1)).toThrow(RangeError);
    expect(() => computeReconnectDelay(1.5)).toThrow(RangeError);
  });
});

describe('computeReconnectDelay with jitter', () => {
  it('shortens the wait by up to the jitter ratio, in proportion to the random value', () => {
    expect(computeReconnectDelay(2, DEFAULT_RECONNECT_BACKOFF, 0)).toBe(1000);
    expect(computeReconnectDelay(2, DEFAULT_RECONNECT_BACKOFF, 0.5)).toBe(
      1000 * (1 - RECONNECT_JITTER_RATIO / 2),
    );
    expect(computeReconnectDelay(2, DEFAULT_RECONNECT_BACKOFF, 0.999)).toBeGreaterThan(
      1000 * (1 - RECONNECT_JITTER_RATIO),
    );
  });

  it('keeps a jittered wait within the cap and above the cap less the jitter', () => {
    for (const randomValue of [0, 0.25, 0.75, 0.99]) {
      const delayMs = computeReconnectDelay(40, DEFAULT_RECONNECT_BACKOFF, randomValue);
      expect(delayMs).toBeLessThanOrEqual(RECONNECT_MAX_DELAY_MS);
      expect(delayMs).toBeGreaterThan(RECONNECT_MAX_DELAY_MS * (1 - RECONNECT_JITTER_RATIO));
    }
  });

  it('follows a custom backoff', () => {
    const backoff = { baseDelayMs: 10, maxDelayMs: 50, jitterRatio: 0 };
    expect([0, 1, 2, 3].map((attempt) => computeReconnectDelay(attempt, backoff, 0.9))).toEqual([
      10, 20, 40, 50,
    ]);
  });

  it('rejects a random value outside [0, 1) and a malformed backoff', () => {
    expect(() => computeReconnectDelay(0, DEFAULT_RECONNECT_BACKOFF, 1)).toThrow(RangeError);
    expect(() => computeReconnectDelay(0, DEFAULT_RECONNECT_BACKOFF, -0.1)).toThrow(RangeError);
    const malformed = [
      { baseDelayMs: 0, maxDelayMs: 10, jitterRatio: 0 },
      { baseDelayMs: 20, maxDelayMs: 10, jitterRatio: 0 },
      { baseDelayMs: 10, maxDelayMs: 10, jitterRatio: 1.5 },
      { baseDelayMs: Number.NaN, maxDelayMs: 10, jitterRatio: 0 },
    ];
    for (const backoff of malformed) {
      expect(() => computeReconnectDelay(0, backoff, 0)).toThrow(RangeError);
    }
  });
});
