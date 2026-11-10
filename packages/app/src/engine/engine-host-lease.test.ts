import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EngineHost } from '@canvas/engine';

import { holdEngineHost } from './engine-host-lease.js';

// A host stand-in that records its destruction.
function fakeHost(): { host: EngineHost; destroy: ReturnType<typeof vi.fn> } {
  const destroy = vi.fn();
  return { host: { destroy } as unknown as EngineHost, destroy };
}

// A canvas stand-in: the lease only keys on its identity.
const newCanvas = (): HTMLCanvasElement => ({}) as HTMLCanvasElement;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('holdEngineHost', () => {
  it('starts one host per canvas and destroys it after the last release', async () => {
    const { host, destroy } = fakeHost();
    const start = vi.fn(() => Promise.resolve(host));
    const canvas = newCanvas();
    const first = holdEngineHost(canvas, start);
    const second = holdEngineHost(canvas, start);
    expect(start).toHaveBeenCalledTimes(1);
    expect(await second.host).toBe(await first.host);
    first.release();
    first.release();
    await vi.runAllTimersAsync();
    expect(destroy).not.toHaveBeenCalled();
    second.release();
    await vi.runAllTimersAsync();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('keeps the host through a release followed by a hold in the same task, as Strict Mode does', async () => {
    const { host, destroy } = fakeHost();
    const start = vi.fn(() => Promise.resolve(host));
    const canvas = newCanvas();
    holdEngineHost(canvas, start).release();
    const remounted = holdEngineHost(canvas, start);
    await vi.runAllTimersAsync();
    expect(start).toHaveBeenCalledTimes(1);
    expect(destroy).not.toHaveBeenCalled();
    expect(await remounted.host).toBe(host);
  });

  it('starts afresh after the host was destroyed, and tolerates a host that failed to start', async () => {
    const canvas = newCanvas();
    const failed = holdEngineHost(canvas, () => Promise.reject(new Error('no GPU')));
    await expect(failed.host).rejects.toThrow('no GPU');
    failed.release();
    await vi.runAllTimersAsync();
    const { host } = fakeHost();
    expect(await holdEngineHost(canvas, () => Promise.resolve(host)).host).toBe(host);
  });
});
