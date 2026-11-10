import { describe, expect, it } from 'vitest';

import { FakeGpuBackend } from '../__fixtures__/fake-gpu-backend.js';

import { LayerTargetPool } from './layer-target-pool.js';

describe('LayerTargetPool', () => {
  it('gives a tile its own target again, another tile a free one of the size, else a new one', () => {
    const backend = new FakeGpuBackend();
    const pool = new LayerTargetPool(backend, 1024);
    const first = pool.acquire('a#0', { width: 100, height: 70 }, 1, 0);
    expect(first).toMatchObject({ width: 128, height: 128 });
    const second = pool.acquire('b#0', { width: 90, height: 90 }, 1, 0);
    expect(second).not.toBe(first);
    expect(pool.acquire('b#0', { width: 120, height: 66 }, 2, 16)).toBe(second);
    expect(pool.acquire('c#0', { width: 70, height: 80 }, 2, 16)).toBe(first);
    expect(pool.acquire('a#0', { width: 100, height: 70 }, 2, 16)).not.toBe(first);
    expect(pool.size).toBe(3);
    expect(pool.byteLength).toBe(3 * 128 * 128 * 4);
  });

  it('frees targets idle for over two seconds, and idle ones first, oldest first, over the limit', () => {
    const backend = new FakeGpuBackend();
    const pool = new LayerTargetPool(backend, 1024);
    // Three sizes, so no tile takes another's target.
    const old = pool.acquire('a#0', { width: 64, height: 64 }, 1, 0);
    const newer = pool.acquire('b#0', { width: 128, height: 64 }, 2, 1000);
    const used = pool.acquire('c#0', { width: 192, height: 64 }, 3, 1500);
    pool.releaseIdle(3, 2000, Number.POSITIVE_INFINITY);
    expect(pool.size).toBe(3);
    pool.releaseIdle(3, 2001, (2 + 3) * 64 * 64 * 4);
    expect(backend.targets.filter(({ isDestroyed }) => isDestroyed)).toEqual([old]);
    pool.releaseIdle(3, 2001, 0);
    expect(newer).toMatchObject({ isDestroyed: true });
    expect(used).toMatchObject({ isDestroyed: false });
    pool.destroyAll();
    expect(pool.size).toBe(0);
    expect(pool.byteLength).toBe(0);
    expect(used).toMatchObject({ isDestroyed: true });
  });

  it('holds the scratch’s extent: its targets’ widest width by their tallest height', () => {
    const pool = new LayerTargetPool(new FakeGpuBackend(), 1024);
    expect(pool.extent).toEqual({ width: 0, height: 0 });
    pool.acquire('a#0', { width: 300, height: 60 }, 1, 0);
    pool.acquire('a#1', { width: 60, height: 200 }, 1, 0);
    pool.acquire('b#0', { width: 100, height: 100 }, 1, 0);
    expect(pool.extent).toEqual({ width: 320, height: 256 });
    expect(pool.heldExtentByLayer()).toEqual(
      new Map([
        ['a', { width: 320, height: 256 }],
        ['b', { width: 128, height: 128 }],
      ]),
    );
    pool.releaseIdle(2, 0, 0);
    expect(pool.extent).toEqual({ width: 0, height: 0 });
    expect(pool.heldExtentByLayer().size).toBe(0);
  });
});
