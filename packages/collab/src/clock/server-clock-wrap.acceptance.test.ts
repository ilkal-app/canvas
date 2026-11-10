import { expect, it, vi } from 'vitest';

import type * as Schema from '@canvas/schema';

vi.mock('@canvas/schema', async (importOriginal) => ({
  ...(await importOriginal<typeof Schema>()),
  MAX_TIME_REQUEST_ID: 3,
}));

import { ServerClock } from './server-clock.js';

it('wraps the request sequence at the wire id limit and still accepts the new zero id', () => {
  let now = 100;
  const clock = new ServerClock({ now: () => now });
  for (const expected of [0, 1, 2, 3]) {
    const id = clock.request();
    expect(id).toBe(expected);
    now += 20;
    clock.receive(id, 1000 + expected * 20 + 10);
  }
  const wrapped = clock.request();
  expect(wrapped).toBe(0);
  clock.receive(wrapped, 2000);
  expect(clock.now()).toBe(2000);
});
