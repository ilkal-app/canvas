// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

import { firstPaintTrace, type FirstPaintMilestone } from './first-paint-trace.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

it('does not expose startup observations in ordinary builds', () => {
  vi.stubEnv('VITE_FIRST_PAINT_DIAGNOSTIC', '');
  const dispatch = vi.spyOn(window, 'dispatchEvent');
  firstPaintTrace('private-board')('authorized-start');
  expect(dispatch).not.toHaveBeenCalled();
});

it('keeps startup generations distinct and records the real page clock', () => {
  vi.stubEnv('VITE_FIRST_PAINT_DIAGNOSTIC', '1');
  const events: FirstPaintMilestone[] = [];
  const receive = (event: Event): void => {
    events.push((event as CustomEvent<FirstPaintMilestone>).detail);
  };
  window.addEventListener('canvas:first-paint', receive);
  try {
    const before = performance.now();
    const first = firstPaintTrace('board');
    first('authorized-start');
    first('cache-read-complete', 42);
    firstPaintTrace('board')('authorized-start');
    expect(events[0]?.attempt).toBe(events[1]?.attempt);
    expect(events[2]?.attempt).not.toBe(events[0]?.attempt);
    expect(events[1]?.previewBytes).toBe(42);
    expect(events[0]?.timeMs).toBeGreaterThanOrEqual(before);
    expect(events[2]?.timeMs).toBeLessThanOrEqual(performance.now());
  } finally {
    window.removeEventListener('canvas:first-paint', receive);
  }
});
