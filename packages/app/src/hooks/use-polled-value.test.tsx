// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePolledValue } from './use-polled-value.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('usePolledValue', () => {
  it('reads once on mount and then once per interval, not more', () => {
    let value = 1;
    const read = vi.fn(() => value);
    const { result } = renderHook(() => usePolledValue(read, 250));
    expect(result.current).toBe(1);
    expect(read).toHaveBeenCalledTimes(1);
    value = 2;
    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(result.current).toBe(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(2);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(read).toHaveBeenCalledTimes(6);
  });

  it('returns undefined and sets no timer without a reader', () => {
    const { result } = renderHook(() => usePolledValue(undefined, 250));
    expect(result.current).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops reading when unmounted', () => {
    const read = vi.fn(() => 0);
    const { unmount } = renderHook(() => usePolledValue(read, 250));
    unmount();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the latest reader without restarting the interval', () => {
    const first = vi.fn(() => 'first');
    const second = vi.fn(() => 'second');
    const { result, rerender } = renderHook(({ read }) => usePolledValue(read, 250), {
      initialProps: { read: first },
    });
    rerender({ read: second });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(result.current).toBe('second');
    expect(first).toHaveBeenCalledTimes(1);
  });

  it('reads at once when a reader appears, then per interval', () => {
    const read = vi.fn(() => 'stats');
    const initialProps: { reader: (() => string) | undefined } = { reader: undefined };
    const { result, rerender } = renderHook(({ reader }) => usePolledValue(reader, 250), {
      initialProps,
    });
    expect(result.current).toBeUndefined();
    rerender({ reader: read });
    expect(result.current).toBe('stats');
    expect(read).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(read).toHaveBeenCalledTimes(2);
    rerender({ reader: undefined });
    expect(result.current).toBeUndefined();
  });

  it('takes a reading a promise answers, keeps the last one when a read rejects, and drops late ones', async () => {
    let reading = Promise.resolve('first');
    const read = vi.fn(() => reading);
    const initialProps: { reader: (() => Promise<string>) | undefined } = { reader: read };
    const { result, rerender } = renderHook(({ reader }) => usePolledValue(reader, 250), {
      initialProps,
    });
    expect(result.current).toBeUndefined();
    await act(() => Promise.resolve());
    expect(result.current).toBe('first');
    reading = Promise.reject(new Error('not recording'));
    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });
    expect(result.current).toBe('first');
    let late: (value: string) => void = () => undefined;
    reading = new Promise((resolve) => {
      late = resolve;
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    rerender({ reader: undefined });
    await act(async () => {
      late('late');
      await Promise.resolve();
    });
    expect(result.current).toBeUndefined();
  });

  it('starts no new read while one is still pending', async () => {
    let answer: (value: string) => void = () => undefined;
    const read = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          answer = resolve;
        }),
    );
    const { result } = renderHook(() => usePolledValue(read, 250));
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () => {
      answer('slow');
      await Promise.resolve();
    });
    expect(result.current).toBe('slow');
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(read).toHaveBeenCalledTimes(2);
  });
});
