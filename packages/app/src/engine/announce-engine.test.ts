import { expect, it, vi } from 'vitest';

import { YjsDocumentStore } from '@canvas/document';
import type { EngineHost, InputMark } from '@canvas/engine';

import { announceEngine, type EngineHostMountOptions } from './engine-host-mount-options.js';
import type { HostView } from './host-view.js';

const mark: InputMark = { kind: 'drag-end', id: 1, timestampMs: 1, markedMs: 2 };

it('hands onEngineReady a loader that flushes the view and a mark sender through it', () => {
  const flush = vi.fn();
  const markInput = vi.fn();
  const view = { flush, markInput } as unknown as HostView;
  const load = vi.fn();
  const cleanup = vi.fn();
  const options: EngineHostMountOptions = {
    prefer: 'main',
    onEngineReady: (...[, , loadDocument, markInput]) => {
      loadDocument([]);
      markInput(mark);
      return cleanup;
    },
  };
  const host = {} as EngineHost;
  const canvas = {} as HTMLCanvasElement;
  expect(announceEngine(options, host, canvas, view, load)).toBe(cleanup);
  expect(load).toHaveBeenCalledWith([]);
  expect(flush).toHaveBeenCalledTimes(1);
  expect(markInput).toHaveBeenCalledWith(mark);
});

it('returns nothing without onEngineReady', () => {
  const view = {} as HostView;
  expect(
    announceEngine({ prefer: 'main' }, {} as EngineHost, {} as HTMLCanvasElement, view, vi.fn()),
  ).toBeUndefined();
});

it("hands onEngineReady a wait for the board's stepped run, at once without a board", async () => {
  const store = new YjsDocumentStore();
  const view = { flush: vi.fn(), markInput: vi.fn() } as unknown as HostView;
  const waits: (() => Promise<void>)[] = [];
  const options: EngineHostMountOptions = {
    prefer: 'main',
    onEngineReady: (...[, , , , whenStoreIdle]) => {
      waits.push(whenStoreIdle);
    },
  };
  const host = {} as EngineHost;
  const canvas = {} as HTMLCanvasElement;
  announceEngine(options, host, canvas, view, vi.fn(), store);
  announceEngine(options, host, canvas, view, vi.fn());
  const run = store.beginRun();
  let isIdle = false;
  const idle = waits[0]?.().then(() => {
    isIdle = true;
  });
  await waits[1]?.();
  await Promise.resolve();
  expect(isIdle).toBe(false);
  run.close();
  await idle;
  expect(isIdle).toBe(true);
  store.destroy();
});
