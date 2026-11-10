// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { YjsDocumentStore } from '@canvas/document';

import { BUSY_INDICATOR_DELAY_MS, useStoreBusy } from './use-store-busy.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('waits 150 ms, reflects progress, and hides when the run closes', () => {
  vi.useFakeTimers();
  expect(BUSY_INDICATOR_DELAY_MS).toBe(150);
  const store = new YjsDocumentStore();
  const { result } = renderHook(() => useStoreBusy(store));
  let run!: ReturnType<typeof store.beginRun>;
  act(() => {
    run = store.beginRun();
  });
  expect(result.current).toEqual({ isShown: false, progress: undefined });
  act(() => {
    vi.advanceTimersByTime(149);
  });
  expect(result.current.isShown).toBe(false);
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(result.current.isShown).toBe(true);
  act(() => {
    run.progress(2, 4);
  });
  expect(result.current.progress).toBe(0.5);
  act(() => {
    run.close();
  });
  expect(result.current).toEqual({ isShown: false, progress: undefined });
  store.destroy();
});

it('never shows a short run, even after the old timer deadline', () => {
  vi.useFakeTimers();
  const store = new YjsDocumentStore();
  const { result } = renderHook(() => useStoreBusy(store));
  act(() => {
    const run = store.beginRun();
    vi.advanceTimersByTime(100);
    run.close();
    vi.advanceTimersByTime(100);
  });
  expect(result.current.isShown).toBe(false);
  store.destroy();
});

it('sees an already-open run and its progress at mount', () => {
  vi.useFakeTimers();
  const store = new YjsDocumentStore();
  const run = store.beginRun();
  run.progress(3, 4);
  const { result } = renderHook(() => useStoreBusy(store));
  expect(result.current).toEqual({ isShown: false, progress: 0.75 });
  act(() => {
    vi.advanceTimersByTime(150);
  });
  expect(result.current).toEqual({ isShown: true, progress: 0.75 });
  act(() => {
    run.close();
  });
  store.destroy();
});

it('hides and clears progress when the store becomes undefined', () => {
  vi.useFakeTimers();
  const store = new YjsDocumentStore();
  const initialProps: { board: YjsDocumentStore | undefined } = { board: store };
  const { result, rerender } = renderHook(({ board }) => useStoreBusy(board), { initialProps });
  let run!: ReturnType<typeof store.beginRun>;
  act(() => {
    run = store.beginRun();
    run.progress(2, 4);
    vi.advanceTimersByTime(150);
  });
  expect(result.current).toEqual({ isShown: true, progress: 0.5 });

  rerender({ board: undefined });
  expect(result.current).toEqual({ isShown: false, progress: undefined });
  run.close();
  store.destroy();
});

it('reads the new store and hides when switching away from an open run', () => {
  vi.useFakeTimers();
  const first = new YjsDocumentStore();
  const second = new YjsDocumentStore();
  const { result, rerender } = renderHook(({ board }) => useStoreBusy(board), {
    initialProps: { board: first },
  });
  let run!: ReturnType<typeof first.beginRun>;
  act(() => {
    run = first.beginRun();
    run.progress(1, 2);
    vi.advanceTimersByTime(150);
  });
  expect(result.current).toEqual({ isShown: true, progress: 0.5 });

  rerender({ board: second });
  expect(result.current).toEqual({ isShown: false, progress: undefined });
  run.close();
  first.destroy();
  second.destroy();
});
