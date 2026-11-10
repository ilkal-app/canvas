import { describe, expect, it, vi } from 'vitest';

import { CacheWriteTracker } from './cache-write-tracker.js';

/**
 * A write whose transaction the test completes or aborts.
 *
 * @returns The write and how to settle it.
 */
function deferredWrite(): {
  readonly write: Promise<void>;
  readonly complete: () => void;
  readonly abort: (error: Error) => void;
} {
  let complete!: () => void;
  let abort!: (error: Error) => void;
  const write = new Promise<void>((resolve, reject) => {
    complete = resolve;
    abort = reject;
  });
  return { write, complete, abort };
}

describe('CacheWriteTracker', () => {
  it('is idle with nothing tracked, and settles at once', async () => {
    const tracker = new CacheWriteTracker();
    expect(tracker.isPending).toBe(false);
    await expect(tracker.settled()).resolves.toBeUndefined();
  });

  it('is pending from the request until the write completes, and says so twice', async () => {
    const tracker = new CacheWriteTracker();
    const seen: boolean[] = [];
    tracker.subscribe(() => seen.push(tracker.isPending));
    const { write, complete } = deferredWrite();
    expect(tracker.track(write)).toBe(write);
    expect(tracker.isPending).toBe(true);
    expect(seen).toEqual([true]);
    complete();
    await tracker.settled();
    expect(tracker.isPending).toBe(false);
    expect(seen).toEqual([true, false]);
  });

  it('counts a write that fails as settled, and still rejects it to its caller', async () => {
    const tracker = new CacheWriteTracker();
    const { write, abort } = deferredWrite();
    const tracked = tracker.track(write);
    abort(new Error('aborted'));
    await expect(tracked).rejects.toThrow('aborted');
    await tracker.settled();
    expect(tracker.isPending).toBe(false);
  });

  it('stays pending across overlapping writes until the last settles', async () => {
    const tracker = new CacheWriteTracker();
    const listener = vi.fn();
    tracker.subscribe(listener);
    const first = deferredWrite();
    const second = deferredWrite();
    void tracker.track(first.write);
    void tracker.track(second.write);
    expect(listener).toHaveBeenCalledTimes(1);
    let isSettled = false;
    void tracker.settled().then(() => {
      isSettled = true;
    });
    first.complete();
    await first.write;
    await Promise.resolve();
    expect(tracker.isPending).toBe(true);
    expect(isSettled).toBe(false);
    const third = deferredWrite();
    void tracker.track(third.write);
    second.abort(new Error('aborted'));
    await second.write.catch(() => undefined);
    await Promise.resolve();
    expect(tracker.isPending).toBe(true);
    expect(isSettled).toBe(false);
    third.complete();
    await tracker.settled();
    await Promise.resolve();
    expect(isSettled).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('stops telling a listener that unsubscribed', () => {
    const tracker = new CacheWriteTracker();
    const listener = vi.fn();
    tracker.subscribe(listener)();
    void tracker.track(deferredWrite().write);
    expect(listener).not.toHaveBeenCalled();
  });

  it('reports a throwing listener asynchronously and still tells the rest', async () => {
    const tracker = new CacheWriteTracker();
    const failure = new Error('listener failed');
    const reported = vi.fn();
    const queueMicrotask = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((task) => {
      try {
        task();
      } catch (error: unknown) {
        reported(error);
      }
    });
    const after = vi.fn();
    const stop = tracker.subscribe(() => {
      throw failure;
    });
    tracker.subscribe(after);
    const { write, complete } = deferredWrite();
    void tracker.track(write);
    queueMicrotask.mockRestore();
    expect(reported).toHaveBeenCalledWith(failure);
    expect(after).toHaveBeenCalledTimes(1);
    stop();
    complete();
    await tracker.settled();
  });

  it('counts new-work holds and calls back once the last is released', () => {
    const onReleased = vi.fn();
    const tracker = new CacheWriteTracker(onReleased);
    expect(tracker.isNewWorkHeld).toBe(false);
    const releaseFirst = tracker.holdNewWork();
    const releaseSecond = tracker.holdNewWork();
    expect(tracker.isNewWorkHeld).toBe(true);
    releaseFirst();
    releaseFirst();
    expect(tracker.isNewWorkHeld).toBe(true);
    expect(onReleased).not.toHaveBeenCalled();
    releaseSecond();
    expect(tracker.isNewWorkHeld).toBe(false);
    expect(onReleased).toHaveBeenCalledTimes(1);
  });

  it('releases a hold without a callback when built without one', () => {
    const tracker = new CacheWriteTracker();
    tracker.holdNewWork()();
    expect(tracker.isNewWorkHeld).toBe(false);
  });
});
