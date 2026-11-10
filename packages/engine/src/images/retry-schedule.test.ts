import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_RETRY_TIMER,
  RETRY_DELAYS_MS,
  RetrySchedule,
  type RetryTimer,
} from './retry-schedule.js';

/** A timer a test runs by hand, recording each wait. */
class ManualTimer {
  readonly waits: number[] = [];
  private readonly due: (() => void)[] = [];

  readonly start: RetryTimer = (callback, delayMs) => {
    this.waits.push(delayMs);
    this.due.push(callback);
    return () => {
      this.due.splice(this.due.indexOf(callback), 1);
    };
  };

  /**
   * How many timers are started and not yet run or stopped.
   *
   * @returns The count.
   */
  get pending(): number {
    return this.due.length;
  }

  /** Runs every timer started so far. */
  runAll(): void {
    for (const callback of this.due.splice(0)) callback();
  }
}

describe('RetrySchedule', () => {
  it('waits longer before each retry, then gives up for good', () => {
    const timer = new ManualTimer();
    const schedule = new RetrySchedule<string>(timer.start);
    const retried: boolean[] = [];

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      expect(schedule.mayTry('a')).toBe(true);
      retried.push(schedule.fail('a', () => undefined));
      expect(schedule.mayTry('a')).toBe(false);
      timer.runAll();
    }

    expect(timer.waits).toEqual([...RETRY_DELAYS_MS]);
    expect(retried).toEqual([true, true, true, true, false]);
    expect(schedule.mayTry('a')).toBe(false);
  });

  it('calls back when a wait is over, and not for a failure forgotten meanwhile', () => {
    const timer = new ManualTimer();
    const schedule = new RetrySchedule<string>(timer.start);
    const due: string[] = [];
    schedule.fail('photo|L512', () => due.push('photo'));
    schedule.fail('other|L512', () => due.push('other'));

    schedule.forgetWhere((key) => key.startsWith('other|'));
    timer.runAll();

    expect(due).toEqual(['photo']);
    expect(schedule.mayTry('other|L512')).toBe(true);
  });

  it('forgets a key that loads after all', () => {
    const timer = new ManualTimer();
    const schedule = new RetrySchedule<string>(timer.start, [10]);
    schedule.fail('a', () => undefined);
    timer.runAll();
    schedule.succeed('a');

    expect(schedule.fail('a', () => undefined)).toBe(true);
    expect(timer.waits).toEqual([10, 10]);
  });
});

describe('RetrySchedule.stopAll', () => {
  it('stops every wait and forgets every failure, so no callback runs after', () => {
    const timer = new ManualTimer();
    const schedule = new RetrySchedule<string>(timer.start);
    const due: string[] = [];
    schedule.fail('a', () => due.push('a'));
    schedule.fail('b', () => due.push('b'));

    schedule.stopAll();
    timer.runAll();

    expect(timer.pending).toBe(0);
    expect(due).toEqual([]);
    expect(schedule.mayTry('a')).toBe(true);
  });

  it('stops only waits still running, and survives a timer that cannot be stopped', () => {
    const timer = new ManualTimer();
    const schedule = new RetrySchedule<string>(timer.start);
    schedule.fail('a', () => undefined);
    timer.runAll();
    const unstoppable = new RetrySchedule<string>(() => undefined);
    unstoppable.fail('a', () => undefined);

    expect(() => {
      schedule.stopAll();
      unstoppable.stopAll();
    }).not.toThrow();
    expect(unstoppable.mayTry('a')).toBe(true);
  });
});

describe('DEFAULT_RETRY_TIMER', () => {
  it("waits on the thread's own setTimeout", () => {
    vi.useFakeTimers();
    const due: number[] = [];

    DEFAULT_RETRY_TIMER(() => due.push(1), 500);
    vi.advanceTimersByTime(499);
    const early = due.length;
    vi.advanceTimersByTime(1);
    vi.useRealTimers();

    expect([early, due.length]).toEqual([0, 1]);
  });

  it('is stopped by what it returns', () => {
    vi.useFakeTimers();
    const due: number[] = [];

    const stop = DEFAULT_RETRY_TIMER(() => due.push(1), 500);
    stop?.();
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();

    expect(due).toEqual([]);
  });
});

describe('RetrySchedule.defer', () => {
  it('waits through repeated server deferrals without spending ordinary failure retries', () => {
    const timer = new ManualTimer();
    const schedule = new RetrySchedule<string>(timer.start);
    const due = vi.fn();
    for (let index = 0; index < 8; index += 1) {
      schedule.defer('tile', 12_000, due);
      expect(schedule.mayTry('tile')).toBe(false);
      timer.runAll();
      expect(schedule.mayTry('tile')).toBe(true);
    }
    expect(due).toHaveBeenCalledTimes(8);
    expect(schedule.fail('tile', due)).toBe(true);
    expect(timer.waits.at(-1)).toBe(RETRY_DELAYS_MS[0]);
    timer.runAll();
    schedule.defer('tile', 20_000, due);
    timer.runAll();
    expect(schedule.fail('tile', due)).toBe(true);
    expect(timer.waits.at(-1)).toBe(RETRY_DELAYS_MS[1]);
  });

  it('cancels deferred callbacks on teardown and refuses to revive exhausted failures', () => {
    const timer = new ManualTimer();
    const schedule = new RetrySchedule<string>(timer.start, [1]);
    const due = vi.fn();
    schedule.defer('tile', 10_000, due);
    schedule.stopAll();
    timer.runAll();
    expect(due).not.toHaveBeenCalled();
    schedule.fail('tile', due);
    timer.runAll();
    expect(schedule.fail('tile', due)).toBe(false);
    expect(schedule.defer('tile', 10_000, due)).toBe(false);
    expect(schedule.mayTry('tile')).toBe(false);
  });
});
