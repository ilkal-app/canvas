import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EngineHost } from '@canvas/engine';

import { withStartTimeout } from './start-browser-host.js';

function fakeHost(): EngineHost & { destroyed: number } {
  const host = {
    destroyed: 0,
    destroy: () => {
      host.destroyed += 1;
    },
  };
  return host as unknown as EngineHost & { destroyed: number };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('withStartTimeout', () => {
  it('settles with a host that starts in time, and stops waiting', async () => {
    const host = fakeHost();
    await expect(withStartTimeout(Promise.resolve(host), 1_000)).resolves.toBe(host);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('passes a start failure on', async () => {
    await expect(
      withStartTimeout(Promise.reject(new Error('no GPU in the worker')), 1_000),
    ).rejects.toThrow('no GPU in the worker');
    await expect(withStartTimeout(Promise.reject(new Error('late')), 1_000)).rejects.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives up on a host that does not start in time, and destroys it if it starts later', async () => {
    const host = fakeHost();
    let start: (value: EngineHost) => void = () => undefined;
    const started = withStartTimeout(
      new Promise<EngineHost>((resolve) => {
        start = resolve;
      }),
      1_000,
    );
    const outcome = expect(started).rejects.toThrow('The engine did not start within 1000 ms.');
    await vi.advanceTimersByTimeAsync(1_000);
    await outcome;
    start(host);
    await vi.advanceTimersByTimeAsync(0);
    expect(host.destroyed).toBe(1);
  });
});
