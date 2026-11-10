import { expect, it } from 'vitest';

import { isTransferStamps, transferTimings } from './transfer-stamps.js';

const stamps = { postedMs: 100, receivedMs: 60, sentMs: 70 };

it('converts both legs to the page clock', () => {
  expect(transferTimings(stamps, 50, 140)).toEqual({ pageToWorker: 10, workerToPage: 20 });
});

it('refuses a negative leg either way', () => {
  expect(transferTimings(stamps, 30, 140)).toBeUndefined();
  expect(transferTimings(stamps, 50, 110)).toBeUndefined();
});

it('checks stamps that crossed a thread', () => {
  expect(isTransferStamps(stamps)).toBe(true);
  expect(isTransferStamps({ ...stamps, sentMs: NaN })).toBe(false);
  expect(isTransferStamps(undefined)).toBe(false);
});
