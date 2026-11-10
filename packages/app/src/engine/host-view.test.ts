import { describe, expect, it, vi } from 'vitest';

import type { EngineHost, PointerInput, SceneStamp } from '@canvas/engine';
import type { ObjectId } from '@canvas/schema';
import { EMPTY_OVERLAY } from '@canvas/tools';

import { createDemoBoard } from './demo-board.js';
import { hostView } from './host-view.js';

describe('hostView', () => {
  it('reads the latest preview once and sends one overlay at the next frame', () => {
    const sent: unknown[] = [];
    let frame: (() => void) | undefined;
    const request = vi.fn((callback: () => void) => {
      frame = callback;
      return 1;
    });
    const host = {
      onFrame: () => () => undefined,
      applyChangeSet: (message: unknown) => sent.push(['changes', message]),
      setOverlay: (model: unknown) => sent.push(['overlay', model]),
    } as unknown as EngineHost;
    const view = hostView(host, { request, cancel: vi.fn() });
    const get = vi.fn(() => undefined);
    view.showOverlay(EMPTY_OVERLAY);
    view.enqueue({ created: [], updated: ['a' as ObjectId], deleted: [], get });
    view.enqueue({ created: [], updated: ['a' as ObjectId], deleted: [], get });
    view.showOverlay({ ...EMPTY_OVERLAY, countBadge: 1000 });
    expect(sent).toEqual([]);
    expect(get).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
    frame?.();
    expect(get).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([
      ['changes', { created: [], updated: ['a' as ObjectId], deleted: [], objects: {} }],
      ['overlay', { ...EMPTY_OVERLAY, countBadge: 1000 }],
    ]);
  });

  it('sends the latest model of each named layer, wrapped for it, before the selection', () => {
    const sent: unknown[] = [];
    let frame: (() => void) | undefined;
    const host = {
      onFrame: () => () => undefined,
      setOverlay: (model: unknown) => sent.push(model),
    } as unknown as EngineHost;
    const view = hostView(host, {
      request: (callback) => {
        frame = callback;
        return 1;
      },
      cancel: vi.fn(),
    });
    view.showLayer('traceTint', { sheets: ['old'] });
    view.showOverlay(EMPTY_OVERLAY);
    view.showLayer('traceTint', { sheets: [] });
    frame?.();
    expect(sent).toEqual([{ overlayLayer: 'traceTint', model: { sheets: [] } }, EMPTY_OVERLAY]);
    sent.length = 0;
    frame?.();
    expect(sent).toEqual([]);
  });

  it('flushes before a synchronous read and cancels pending work on destruction', () => {
    const cancel = vi.fn();
    const applyChangeSet = vi.fn();
    const setOverlay = vi.fn();
    const host = {
      applyChangeSet,
      setOverlay,
      onFrame: () => () => undefined,
    } as unknown as EngineHost;
    const view = hostView(host, { request: () => 7, cancel });
    view.showOverlay(EMPTY_OVERLAY);
    view.flush();
    expect(cancel).toHaveBeenCalledWith(7);
    expect(setOverlay).toHaveBeenCalledOnce();
    view.showOverlay(EMPTY_OVERLAY);
    view.destroy();
    view.flush();
    view.showOverlay(EMPTY_OVERLAY);
    view.enqueue({ created: [], updated: [], deleted: [], get: () => undefined });
    expect(setOverlay).toHaveBeenCalledOnce();
    expect(applyChangeSet).not.toHaveBeenCalled();
  });
});

it('keeps every input timestamp behind the latest retained snapshot and ends before ordinary edits', () => {
  const sent: unknown[] = [];
  const host = {
    onFrame: () => () => undefined,
    applyChangeSet: (message: unknown) => sent.push(message),
    pointer: (input: unknown) => sent.push(input),
  } as unknown as EngineHost;
  const view = hostView(host, { request: () => 1, cancel: () => undefined });
  const ids = ['a' as ObjectId];
  const objects = createDemoBoard().slice(0, 1);
  const model = (x: number) => ({ ids, objects, positions: new Float64Array([x, 0]) });
  const pointer = (timestampMs: number): PointerInput => ({
    type: 'move',
    xPx: 1,
    yPx: 2,
    buttons: 1,
    pointerId: 1,
    timestampMs,
  });
  view.showMovePreview?.(model(10));
  view.pointer(pointer(1));
  view.showMovePreview?.(model(20));
  view.pointer(pointer(2));
  view.flush();
  expect(sent).toEqual([
    {
      created: [],
      updated: [],
      deleted: [],
      objects: {},
      retainedMove: {
        kind: 'begin',
        session: 1,
        sequence: 0,
        objects,
        positions: new Float64Array([20, 0]),
      },
    },
    pointer(1),
    pointer(2),
  ]);
  sent.length = 0;
  view.enqueue({ created: [], updated: ids, deleted: [], get: () => undefined });
  view.flush();
  expect(sent).toEqual([
    {
      created: [],
      updated: [],
      deleted: [],
      objects: {},
      retainedMove: {
        kind: 'end',
        session: 1,
        sequence: 1,
      },
    },
    { created: [], updated: ids, deleted: [], objects: {} },
  ]);
});

it('preserves one contiguous certificate stream when a host receives a replacement view', () => {
  const stamps: unknown[] = [];
  const host = {
    onFrame: () => () => undefined,
    applyChangeSet: (message: unknown, stamp: unknown) => {
      stamps.push(stamp);
    },
  } as unknown as EngineHost;
  const changes = { created: [], updated: ['a' as ObjectId], deleted: [], get: () => undefined };
  for (let index = 0; index < 2; index++) {
    const view = hostView(host, { request: () => 1, cancel: () => undefined });
    view.enqueue(changes);
    view.flush();
    view.destroy();
  }
  expect(typeof (stamps[0] as SceneStamp | undefined)?.session).toBe('string');
  expect(stamps[0]).toHaveProperty('sequence', 0);
  expect(stamps[1]).toMatchObject({ ...(stamps[0] as object), sequence: 1 });
});
