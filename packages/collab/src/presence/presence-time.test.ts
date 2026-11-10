import { afterEach, describe, expect, it, vi } from 'vitest';

import { systemPresenceClock, timeoutPresenceScheduler } from './presence-time.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('systemPresenceClock', () => {
  it('reads the wall clock in ms', () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });

    expect(systemPresenceClock.now()).toBe(1_700_000_000_000);
  });
});

describe('timeoutPresenceScheduler', () => {
  it('runs a callback once its delay has passed', () => {
    vi.useFakeTimers();
    const callback = vi.fn();

    timeoutPresenceScheduler.schedule(callback, 40);
    vi.advanceTimersByTime(39);
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledOnce();
  });

  it('never runs a cancelled callback', () => {
    vi.useFakeTimers();
    const callback = vi.fn();

    timeoutPresenceScheduler.schedule(callback, 40).cancel();
    vi.advanceTimersByTime(100);

    expect(callback).not.toHaveBeenCalled();
  });
});
