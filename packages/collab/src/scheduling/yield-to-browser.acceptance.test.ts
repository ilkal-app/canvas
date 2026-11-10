import { afterEach, describe, expect, it, vi } from 'vitest';

import * as Collab from '@canvas/collab';

const yieldToBrowser = (Collab as typeof Collab & { yieldToBrowser: () => Promise<void> })
  .yieldToBrowser;

afterEach(() => vi.unstubAllGlobals());

describe('yieldToBrowser', () => {
  it('awaits scheduler.yield when the browser provides it', async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const yieldScheduler = vi.fn(() => pending);
    vi.stubGlobal('scheduler', { yield: yieldScheduler });
    let isResolved = false;
    const yielding = yieldToBrowser().then(() => {
      isResolved = true;
    });
    expect(yieldScheduler).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(isResolved).toBe(false);
    release?.();
    await yielding;
    expect(isResolved).toBe(true);
  });

  it('uses a later macrotask when scheduler.yield is unavailable', async () => {
    vi.stubGlobal('scheduler', undefined);
    let didRunMicrotask = false;
    let didResolve = false;
    const yielding = yieldToBrowser().then(() => {
      didResolve = true;
      expect(didRunMicrotask).toBe(true);
    });
    queueMicrotask(() => {
      didRunMicrotask = true;
    });
    expect(didResolve).toBe(false);
    await Promise.resolve();
    expect(didResolve).toBe(false);
    await yielding;
    expect(didResolve).toBe(true);
  });
});
