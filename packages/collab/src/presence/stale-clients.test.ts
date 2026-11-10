import { describe, expect, it } from 'vitest';

import { findStaleClients } from './stale-clients.js';

describe('findStaleClients', () => {
  const lastSeenAtMs = new Map([
    [1, 0],
    [2, 5_000],
    [3, 29_999],
  ]);

  it('finds the clients not heard from for the whole timeout', () => {
    expect(findStaleClients(lastSeenAtMs, 30_000, 30_000)).toEqual([1]);
    expect(findStaleClients(lastSeenAtMs, 35_000, 30_000)).toEqual([1, 2]);
  });

  it('finds nobody while every client is within the timeout', () => {
    expect(findStaleClients(lastSeenAtMs, 29_999, 30_000)).toEqual([]);
  });
});
