import { afterEach, describe, expect, it, vi } from 'vitest';

import { yieldToBrowser } from './yield-to-browser.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('yieldToBrowser', () => {
  it('falls back to a zero-delay timeout without scheduler.yield or MessageChannel', async () => {
    vi.stubGlobal('scheduler', {});
    vi.stubGlobal('MessageChannel', undefined);
    vi.useFakeTimers();
    let didResolve = false;
    const yielding = yieldToBrowser().then(() => {
      didResolve = true;
    });
    await Promise.resolve();
    expect(didResolve).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    await yielding;
    expect(didResolve).toBe(true);
  });
});
