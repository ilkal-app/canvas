import { afterEach, expect, it, vi } from 'vitest';

import type { BrowserHostPlatform } from '@canvas/engine';

import { flushHarnessFrames, harnessFramePlatform } from './harness-frames.js';

function fixture(): { readonly request: () => void; readonly calls: number[] } {
  const calls: number[] = [];
  const platform: BrowserHostPlatform = {
    hasAnimationFrames: true,
    timeOriginMs: 0,
    now: () => 42,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => undefined,
    canRenderInWorker: () => false,
    createBackend: () => {
      throw new Error('Not used in a scheduler test.');
    },
    transferControlToOffscreen: () => {
      throw new Error('Not used in a scheduler test.');
    },
  };
  const wrapped = harnessFramePlatform(platform);
  return {
    calls,
    request: () => {
      wrapped.requestAnimationFrame((time) => calls.push(time));
    },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('requires both the harness build and the explicit frozen-clock marker', () => {
  const { request, calls } = fixture();
  request();
  vi.stubGlobal('isCanvasHarnessClockFrozen', true);
  vi.stubEnv('VITE_CANVAS_HARNESS', '');
  flushHarnessFrames();
  expect(calls).toEqual([]);
  vi.stubEnv('VITE_CANVAS_HARNESS', '1');
  vi.stubGlobal('isCanvasHarnessClockFrozen', false);
  flushHarnessFrames();
  expect(calls).toEqual([]);
  vi.stubGlobal('isCanvasHarnessClockFrozen', true);
  flushHarnessFrames();
  expect(calls).toEqual([42]);
});

it('cancels a pending frame in the harness queue and on the real platform', () => {
  const cancelled: number[] = [];
  const platform: BrowserHostPlatform = {
    hasAnimationFrames: true,
    timeOriginMs: 0,
    now: () => 42,
    requestAnimationFrame: () => 9,
    cancelAnimationFrame: (handle) => cancelled.push(handle),
    canRenderInWorker: () => false,
    createBackend: () => {
      throw new Error('Not used in a scheduler test.');
    },
    transferControlToOffscreen: () => {
      throw new Error('Not used in a scheduler test.');
    },
  };
  const wrapped = harnessFramePlatform(platform);
  const calls: number[] = [];
  const handle = wrapped.requestAnimationFrame((time) => calls.push(time));
  wrapped.cancelAnimationFrame(handle);
  expect(cancelled).toEqual([9]);
  vi.stubEnv('VITE_CANVAS_HARNESS', '1');
  vi.stubGlobal('isCanvasHarnessClockFrozen', true);
  flushHarnessFrames();
  expect(calls).toEqual([]);
  expect(cancelled).toEqual([9]);
});
