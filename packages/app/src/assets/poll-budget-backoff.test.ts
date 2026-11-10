import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { DEFAULT_SCHEDULE, PollBudget } from './poll-budget.js';

beforeEach(() => vi.useFakeTimers({ now: 0 }));
afterEach(() => vi.useRealTimers());

it('backs off 300 due IDs below six polls per minute and recovers on news', async () => {
  const times: number[] = [];
  const budget = new PollBudget<string>(DEFAULT_SCHEDULE, Date.now, (key) => {
    times.push(Date.now());
    budget.recordResult(false, budget.generation);
    budget.enqueue(key, key, Date.now());
  });
  for (let i = 0; i < 300; i += 1) budget.enqueue(String(i), String(i), 0);
  await vi.advanceTimersByTimeAsync(300000);
  for (const start of [120000, 180000, 240000])
    expect(times.filter((at) => at >= start && at < start + 60000).length).toBeLessThanOrEqual(6);
  const before = times.length;
  budget.recordResult(true);
  await vi.advanceTimersByTimeAsync(5000);
  expect(times.length - before).toBeGreaterThanOrEqual(4);
  budget.close();
});

it('ignores stale no-news completions after news recovery', async () => {
  const sent: number[] = [];
  const budget = new PollBudget<string>(DEFAULT_SCHEDULE, Date.now, () => sent.push(Date.now()));
  for (let i = 0; i < 300; i += 1) budget.enqueue(String(i), String(i), 0);
  const old = budget.generation;
  for (let i = 0; i < 16; i += 1) budget.recordResult(false, old);
  budget.recordResult(true);
  for (let i = 0; i < 100; i += 1) budget.recordResult(false, old);
  await vi.advanceTimersByTimeAsync(15000);
  expect(sent).toHaveLength(16);
  budget.close();
});

it('rechecks capacity before each dispatch without spinning or losing queued work', async () => {
  let blockedUntil = 20000;
  let reads = 0;
  const sent: number[] = [];
  const budget = new PollBudget<string>(
    DEFAULT_SCHEDULE,
    Date.now,
    () => {
      sent.push(Date.now());
      blockedUntil = Date.now() + 20000;
    },
    4,
    5000,
    () => {
      reads += 1;
      return Math.max(0, blockedUntil - Date.now());
    },
  );
  for (let i = 0; i < 300; i += 1) budget.enqueue(String(i), String(i), 0);
  await vi.advanceTimersByTimeAsync(59999);
  expect(sent).toEqual([20000, 40000]);
  expect(budget.size).toBe(298);
  expect(reads).toBeLessThan(330);
  budget.close();
});
