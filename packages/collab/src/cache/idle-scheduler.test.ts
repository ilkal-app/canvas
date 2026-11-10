import { describe, expect, it, vi } from 'vitest';

import { createIdleScheduler } from './idle-scheduler.js';

describe('createIdleScheduler', () => {
  it('uses requestIdleCallback with the timeout, and cancels through cancelIdleCallback', () => {
    const host = {
      requestIdleCallback: vi.fn<(callback: () => void, options: { timeout: number }) => number>(
        () => 7,
      ),
      cancelIdleCallback: vi.fn(),
    };
    const callback = vi.fn();
    const task = createIdleScheduler(host).schedule(callback, 5_000);
    expect(host.requestIdleCallback).toHaveBeenCalledWith(callback, { timeout: 5_000 });
    task.cancel();
    expect(host.cancelIdleCallback).toHaveBeenCalledWith(7);
  });

  it('falls back to a zero-delay timeout where the host has no idle callback', async () => {
    const callback = vi.fn();
    createIdleScheduler({}).schedule(callback, 5_000);
    expect(callback).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledOnce();
    });
    const cancelled = vi.fn();
    createIdleScheduler({}).schedule(cancelled, 5_000).cancel();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(cancelled).not.toHaveBeenCalled();
  });

  it('reads the platform by default', () => {
    expect(typeof createIdleScheduler().schedule).toBe('function');
  });
});
