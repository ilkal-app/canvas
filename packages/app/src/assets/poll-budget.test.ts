import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { settle } from './__fixtures__/manual-schedule.js';
import {
  DEFAULT_SCHEDULE,
  FOLLOW_DELAYS_MS,
  MAX_FOLLOW_ATTEMPTS,
  POLL_BUDGET,
  POLL_INTERVAL_MS,
  PollBudget,
  UNLINKED_FIRST_ATTEMPT,
  WORST_CASE_POLLS_PER_MINUTE,
} from './poll-budget.js';

describe('DEFAULT_SCHEDULE', () => {
  it('runs a callback after its wait, and never once cancelled', async () => {
    const ran: string[] = [];
    DEFAULT_SCHEDULE(() => ran.push('kept'), 0);
    const cancel = DEFAULT_SCHEDULE(() => ran.push('cancelled'), 0);
    cancel();
    await settle();
    expect(ran).toEqual(['kept']);
  });
});

describe('the poll constants', () => {
  it('state the worst case: 48 record requests a minute, waits up to five minutes', () => {
    expect(WORST_CASE_POLLS_PER_MINUTE).toBe((POLL_BUDGET * 60_000) / POLL_INTERVAL_MS);
    expect(FOLLOW_DELAYS_MS.at(-1)).toBe(300_000);
    expect(FOLLOW_DELAYS_MS[UNLINKED_FIRST_ATTEMPT]).toBe(15_000);
    expect(MAX_FOLLOW_ATTEMPTS).toBeGreaterThan(UNLINKED_FIRST_ATTEMPT);
  });
});

describe('PollBudget', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * A budget of two polls per second on the fake timers.
   *
   * @returns The budget and the polls it sent, with their times.
   */
  function budgetOfTwo() {
    const sent: [string, number][] = [];
    const budget = new PollBudget<string>(
      DEFAULT_SCHEDULE,
      Date.now,
      (key) => sent.push([key, Date.now()]),
      2,
      1000,
    );
    return { budget, sent };
  }

  it('sends the due polls a run at a time: preferred first, then the longest due', async () => {
    const { budget, sent } = budgetOfTwo();
    budget.setPaused(true);
    budget.enqueue('late', 'late', 30);
    budget.enqueue('early', 'early', 10);
    budget.enqueue('seen', 'seen', 20);
    budget.enqueue('later', 'later', 5000);
    budget.setPreferred(new Set(['seen']));
    await vi.advanceTimersByTimeAsync(100);
    budget.setPaused(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([
      ['seen', 100],
      ['early', 100],
    ]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent.at(-1)).toEqual(['late', 1100]);
    expect(budget.size).toBe(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(sent.at(-1)).toEqual(['later', 5000]);
  });

  it('sends nothing paused, resumes at once, and stops for good once closed', async () => {
    const { budget, sent } = budgetOfTwo();
    budget.setPaused(true);
    budget.setPaused(true);
    budget.enqueue('a', 'a', 0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent).toEqual([]);
    budget.setPaused(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([['a', 10_000]]);
    budget.enqueue('b', 'b', 0);
    budget.close();
    budget.enqueue('c', 'c', 0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent).toHaveLength(1);
    expect(budget.remove('b')).toBe(false);
  });

  it('drops a removed poll, and its timer with the last one', async () => {
    const { budget, sent } = budgetOfTwo();
    budget.enqueue('a', 'a', 100);
    expect(budget.remove('a')).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toEqual([]);
  });
});
