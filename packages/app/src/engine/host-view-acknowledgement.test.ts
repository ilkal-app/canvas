import { expect, it, vi } from 'vitest';

import type { EngineHost, PointerInput } from '@canvas/engine';

import { createDemoBoard } from './demo-board.js';
import { hostView } from './host-view.js';

function fixture() {
  const callbacks = new Map<number, () => void>();
  let next = 0;
  let report: (() => void) | undefined;
  const acknowledgements: { resolve: (frame: number) => void; reject: (error: Error) => void }[] =
    [];
  const sent: string[] = [];
  const applyChangeSet = vi.fn(() => {
    sent.push('scene');
  });
  const pointer = vi.fn<(input: PointerInput) => void>(() => {
    sent.push('pointer');
  });
  const requestFrameAcknowledgement = vi.fn(() => {
    sent.push('marker');
    return new Promise<number>((resolve, reject) => acknowledgements.push({ resolve, reject }));
  });
  const host = {
    applyChangeSet,
    pointer,
    setOverlay: vi.fn(),
    requestFrameAcknowledgement,
    onFrame: (listener: () => void) => {
      report = listener;
      return () => undefined;
    },
  } as unknown as EngineHost;
  const view = hostView(host, {
    request: (callback) => {
      callbacks.set(++next, callback);
      return next;
    },
    cancel: (handle) => {
      callbacks.delete(handle);
    },
  });
  const tick = () => {
    const pending = [...callbacks.values()];
    callbacks.clear();
    for (const callback of pending) callback();
  };
  const objects = createDemoBoard().slice(0, 1);
  const ids = objects.map((object) => object.id);
  const move = (x: number) => {
    view.showMovePreview?.({ ids, objects, positions: new Float64Array([x, 0]) });
  };
  const input = (timestampMs: number): PointerInput => ({
    type: 'move',
    xPx: 1,
    yPx: 2,
    buttons: 1,
    pointerId: 1,
    timestampMs,
  });
  const change = { created: [], updated: ids, deleted: [], get: () => undefined };
  return {
    view,
    tick,
    move,
    input,
    change,
    report: () => report?.(),
    acknowledgements,
    applyChangeSet,
    pointer,
    sent,
    requestFrameAcknowledgement,
  };
}

it('keeps first RAF and permits only two retained batches with markers after real inputs', async () => {
  const f = fixture();
  f.move(1);
  f.view.pointer(f.input(10));
  expect(f.sent).toEqual([]);
  f.tick();
  f.move(2);
  f.view.pointer(f.input(20));
  f.tick();
  expect(f.sent).toEqual(['scene', 'pointer', 'marker', 'scene', 'pointer', 'marker']);
  f.move(3);
  f.view.pointer(f.input(30));
  f.move(4);
  f.view.pointer(f.input(40));
  f.tick();
  f.report();
  expect(f.applyChangeSet).toHaveBeenCalledTimes(2);
  f.acknowledgements[0]?.resolve(1);
  await Promise.resolve();
  expect(f.applyChangeSet).toHaveBeenCalledTimes(3);
  expect(f.pointer.mock.calls.map((args) => args[0])).toEqual([
    f.input(10),
    f.input(20),
    f.input(30),
    f.input(40),
  ]);
  f.view.destroy();
});

it('keeps ordinary changes behind outstanding batches but explicit reads can flush', async () => {
  const f = fixture();
  f.move(1);
  f.tick();
  f.move(2);
  f.tick();
  f.view.enqueue(f.change);
  f.tick();
  f.acknowledgements[0]?.resolve(1);
  await Promise.resolve();
  expect(f.applyChangeSet).toHaveBeenCalledTimes(2);
  f.acknowledgements[1]?.resolve(1);
  await Promise.resolve();
  expect(f.applyChangeSet).toHaveBeenCalledTimes(4); // End plus ordinary document change.
  f.view.enqueue(f.change);
  f.view.flush();
  expect(f.applyChangeSet).toHaveBeenCalledTimes(5);
  f.view.destroy();
});

it('does not let old acknowledgements release new credits after recovery or destruction', async () => {
  const f = fixture();
  f.move(1);
  f.tick();
  f.move(2);
  f.tick();
  f.move(3);
  f.view.releaseFrame(); // Recovery sends the current queued state.
  f.move(4);
  f.tick();
  f.move(5);
  f.tick();
  const sent = f.applyChangeSet.mock.calls.length;
  f.acknowledgements[0]?.resolve(1);
  f.acknowledgements[1]?.reject(new Error('old fault'));
  await Promise.resolve();
  expect(f.applyChangeSet).toHaveBeenCalledTimes(sent);
  f.acknowledgements[2]?.reject(new Error('frame failed'));
  await Promise.resolve();
  expect(f.applyChangeSet.mock.calls.length).toBeGreaterThan(sent);
  f.view.destroy();
  const closed = f.applyChangeSet.mock.calls.length;
  for (const [index, ack] of f.acknowledgements.entries()) {
    if (index % 2) ack.reject(new Error('destroyed'));
    else ack.resolve(9);
  }
  await Promise.resolve();
  f.tick();
  expect(f.applyChangeSet).toHaveBeenCalledTimes(closed);
});

it('does not mistake synchronous unrelated reports for the reserved marker', async () => {
  const f = fixture();
  f.requestFrameAcknowledgement.mockImplementationOnce(() => {
    f.move(2);
    f.report();
    return Promise.resolve(1);
  });
  f.move(1);
  f.tick();
  expect(f.applyChangeSet).toHaveBeenCalledTimes(1);
  await Promise.resolve();
  expect(f.applyChangeSet).toHaveBeenCalledTimes(2);
  f.view.destroy();
});

it('releases the reserved credit if requesting acknowledgement throws', () => {
  const f = fixture();
  f.requestFrameAcknowledgement.mockImplementationOnce(() => {
    throw new Error('failed marker');
  });
  f.view.enqueue(f.change);
  f.tick();
  f.view.enqueue(f.change);
  f.tick();
  expect(f.applyChangeSet).toHaveBeenCalledTimes(2);
  f.view.destroy();
});

it('rechecks ordinary pacing when a retained RAF was already queued', async () => {
  const f = fixture();
  f.move(1);
  f.tick();
  f.move(2);
  f.view.enqueue(f.change);
  f.tick();
  expect(f.applyChangeSet).toHaveBeenCalledTimes(1);
  f.acknowledgements[0]?.resolve(1);
  await Promise.resolve();
  expect(f.applyChangeSet).toHaveBeenCalledTimes(3);
  f.view.destroy();
});
