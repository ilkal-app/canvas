import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LONG_PRESS_MS } from '@canvas/tools';

import { LongPressTimer } from './long-press-timer.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function setUp(clock: () => number = () => 0) {
  const holds: { timeStamp: number; screen: { x: number; y: number } }[] = [];
  const timer = new LongPressTimer((timeStamp, screen) => holds.push({ timeStamp, screen }), clock);
  return { timer, holds };
}

describe('LongPressTimer', () => {
  it('fires once, LONG_PRESS_MS after the press, with where the finger is then', () => {
    const { timer, holds } = setUp(() => 2_500);
    timer.start(2_000, { x: 10, y: 10 });
    timer.follow({ x: 15, y: 13 });
    vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    expect(holds).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(holds).toEqual([{ timeStamp: 2_500, screen: { x: 15, y: 13 } }]);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(holds).toHaveLength(1);
  });

  it('never reports a time before the delay, if the page clock runs a hair behind', () => {
    const { timer, holds } = setUp(() => 2_499.6);
    timer.start(2_000, { x: 0, y: 0 });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(holds[0]?.timeStamp).toBe(2_000 + LONG_PRESS_MS);
  });

  it('stops for good once the finger has wandered 8 px, even if it comes back', () => {
    const { timer, holds } = setUp();
    timer.start(0, { x: 0, y: 0 });
    timer.follow({ x: 7.9, y: 0 });
    timer.follow({ x: 0, y: 8 });
    timer.follow({ x: 0, y: 0 });
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    expect(holds).toEqual([]);
  });
});
