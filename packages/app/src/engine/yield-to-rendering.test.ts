import { afterEach, expect, it, vi } from 'vitest';

import { yieldToRendering } from './yield-to-rendering.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

it('goes on in a background task where the browser schedules tasks by priority', async () => {
  const postTask = vi.fn((callback: () => void) => {
    callback();
    return Promise.resolve();
  });
  vi.stubGlobal('scheduler', { postTask });
  await yieldToRendering();
  expect(postTask).toHaveBeenCalledWith(expect.any(Function), { priority: 'background' });
});

it('yields to the browser where there is no scheduler', async () => {
  vi.stubGlobal('scheduler', undefined);
  await expect(yieldToRendering()).resolves.toBeUndefined();
});
