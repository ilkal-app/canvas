import { afterEach, expect, it, vi } from 'vitest';

import { waitForFence } from './webgl2-fence.js';

afterEach(() => {
  vi.useRealTimers();
});

function fakeContext(statuses: () => string, sync: object | null = {}) {
  const deleteSync = vi.fn();
  const flush = vi.fn();
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 'complete',
    SYNC_STATUS: 'status',
    SIGNALED: 'signaled',
    fenceSync: () => sync,
    flush,
    getSyncParameter: statuses,
    deleteSync,
  } as unknown as WebGL2RenderingContext;
  return { gl, deleteSync, flush };
}

it('settles at once for a fence that already signalled, flushing it first', async () => {
  const { gl, deleteSync, flush } = fakeContext(() => 'signaled');
  await waitForFence(gl);
  expect(flush).toHaveBeenCalledTimes(1);
  expect(deleteSync).toHaveBeenCalledTimes(1);
});

it('rejects when no fence can be made', async () => {
  const { gl } = fakeContext(() => 'signaled', null);
  await expect(waitForFence(gl)).rejects.toThrow('could not create a fence');
});

it('gives up on a fence that never signals, and still deletes it', async () => {
  vi.useFakeTimers();
  const { gl, deleteSync } = fakeContext(() => 'unsignaled');
  const waiting = expect(waitForFence(gl)).rejects.toThrow('never signalled');
  await vi.runAllTimersAsync();
  await waiting;
  expect(deleteSync).toHaveBeenCalledTimes(1);
});
