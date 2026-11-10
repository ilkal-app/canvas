import { expect, it, vi } from 'vitest';

import type { EngineHost } from '@canvas/engine';
import type { ObjectId } from '@canvas/schema';

import { hostView } from './host-view.js';

it('waits for the rendered batch before encoding the latest queued preview', () => {
  const callbacks = new Map<number, () => void>();
  let next = 0;
  let report: (() => void) | undefined;
  const stop = vi.fn();
  const applyChangeSet = vi.fn();
  const pointer = vi.fn();
  const host = {
    applyChangeSet,
    setOverlay: vi.fn(),
    pointer,
    onFrame: (listener: () => void) => {
      report = listener;
      return stop;
    },
  } as unknown as EngineHost;
  const view = hostView(host, {
    request: (callback) => {
      callbacks.set(++next, callback);
      return next;
    },
    cancel: (id) => {
      callbacks.delete(id);
    },
  });
  const tick = () => {
    const pending = [...callbacks.values()];
    callbacks.clear();
    for (const callback of pending) callback();
  };
  const seen: number[] = [];
  const change = (version: number) => ({
    created: [],
    updated: ['a' as ObjectId],
    deleted: [],
    get: () => {
      seen.push(version);
      return undefined;
    },
  });
  view.enqueue(change(1));
  tick();
  expect(applyChangeSet).toHaveBeenCalledTimes(1);
  const firstPointer = {
    type: 'move' as const,
    xPx: 1,
    yPx: 2,
    buttons: 1,
    pointerId: 7,
    timestampMs: 11,
  };
  const lastPointer = { ...firstPointer, timestampMs: 23 };
  view.pointer(firstPointer);
  view.enqueue(change(2));
  tick();
  view.pointer(lastPointer);
  view.enqueue(change(3));
  tick();
  expect(applyChangeSet).toHaveBeenCalledTimes(1);
  expect(seen).toEqual([1]);
  expect(pointer).not.toHaveBeenCalled();
  report?.();
  expect(applyChangeSet).toHaveBeenCalledTimes(2); // Already coalesced: no extra page RAF.
  tick();
  expect(applyChangeSet).toHaveBeenCalledTimes(2);
  expect(seen).toEqual([1, 3]);
  expect(pointer.mock.calls).toEqual([[firstPointer], [lastPointer]]);
  view.enqueue(change(4));
  view.flush();
  expect(applyChangeSet).toHaveBeenCalledTimes(3);
  expect(seen).toEqual([1, 3, 4]);
  view.releaseFrame(); // A failed frame with no queued work must not stall future input.
  view.enqueue(change(5));
  tick();
  expect(applyChangeSet).toHaveBeenCalledTimes(4);
  view.enqueue(change(6));
  view.releaseFrame(); // The mount's existing fault handler also releases queued work.
  tick();
  expect(applyChangeSet).toHaveBeenCalledTimes(5);
  view.enqueue(change(7));
  view.destroy();
  report?.();
  tick();
  expect(applyChangeSet).toHaveBeenCalledTimes(5);
  expect(stop).toHaveBeenCalledOnce();
});

it('defers a reentrant report until the current batch has finished sending', () => {
  const callbacks: (() => void)[] = [];
  let report: (() => void) | undefined;
  const changes = { created: [], updated: ['a' as ObjectId], deleted: [], get: () => undefined };
  let hasReentered = false;
  const applyChangeSet = vi.fn(() => {
    if (hasReentered) return;
    hasReentered = true;
    view.enqueue(changes);
    report?.();
    expect(applyChangeSet).toHaveBeenCalledTimes(1);
  });
  const host = {
    applyChangeSet,
    setOverlay: vi.fn(),
    pointer: vi.fn(),
    onFrame: (listener: () => void) => {
      report = listener;
      return () => undefined;
    },
  } as unknown as EngineHost;
  const view = hostView(host, {
    request: (callback) => callbacks.push(callback),
    cancel: () => undefined,
  });
  view.enqueue(changes);
  callbacks.shift()?.();
  expect(applyChangeSet).toHaveBeenCalledTimes(1);
  expect(callbacks).toHaveLength(1);
  callbacks.shift()?.();
  expect(applyChangeSet).toHaveBeenCalledTimes(2);
  view.destroy();
});
