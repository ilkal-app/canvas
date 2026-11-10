import { describe, expect, it } from 'vitest';

import { REGENERATION_WINDOW_MS } from '../memory/eviction-memory.js';

import { MeshCache } from './mesh-cache.js';

interface TestMesh {
  readonly name: string;
  readonly byteLength: number;
}

const mesh = (name: string, byteLength = 100): TestMesh => ({ name, byteLength });

function cacheWithBudget(byteBudget: number): { cache: MeshCache<TestMesh>; dropped: string[] } {
  const dropped: string[] = [];
  const cache = new MeshCache<TestMesh>({
    byteBudget,
    onDrop: (dropping) => dropped.push(dropping.name),
  });
  return { cache, dropped };
}

describe('MeshCache', () => {
  it('returns a mesh by object, version and bucket, and counts its bytes', () => {
    const { cache } = cacheWithBudget(1000);
    cache.set('a', 1, 0, mesh('a1@0'));
    cache.set('a', 1, 2, mesh('a1@2', 50));
    expect(cache.get('a', 1, 0)?.name).toBe('a1@0');
    expect(cache.get('a', 1, 2)?.name).toBe('a1@2');
    expect(cache.get('a', 1, 4)).toBeUndefined();
    expect(cache.get('a', 2, 0)).toBeUndefined();
    expect(cache.get('b', 1, 0)).toBeUndefined();
    expect(cache.byteLength).toBe(150);
    expect(cache.byteBudget).toBe(1000);
    expect(cache.size).toBe(2);
  });

  it('evicts the least recently used meshes first, down to the budget', () => {
    const { cache, dropped } = cacheWithBudget(300);
    cache.set('a', 1, 0, mesh('a'));
    cache.set('b', 1, 0, mesh('b'));
    cache.set('c', 1, 0, mesh('c'));
    cache.beginFrame();
    // 'a' is drawn again, so 'b' is now the least recently used.
    cache.get('a', 1, 0);
    cache.beginFrame();
    cache.set('d', 1, 0, mesh('d'));
    expect(dropped).toEqual(['b']);
    expect(cache.byteLength).toBe(300);
    cache.set('e', 1, 0, mesh('e', 150));
    expect(dropped).toEqual(['b', 'c', 'a']);
    expect(cache.byteLength).toBe(250);
    expect(cache.evictions).toBe(3);
  });

  it('never evicts a mesh drawn this frame, even over the budget', () => {
    const { cache, dropped } = cacheWithBudget(150);
    cache.beginFrame();
    cache.set('a', 1, 0, mesh('a'));
    cache.set('b', 1, 0, mesh('b'));
    expect(dropped).toEqual([]);
    expect(cache.byteLength).toBe(200);
    expect(cache.isOverBudget).toBe(true);
    // Next frame only 'b' is on screen: the off-screen 'a' goes first.
    cache.beginFrame();
    cache.get('b', 1, 0);
    cache.trim();
    expect(dropped).toEqual(['a']);
    expect(cache.isOverBudget).toBe(false);
  });

  it('drops the older versions of an object when a newer one arrives', () => {
    const { cache, dropped } = cacheWithBudget(1000);
    cache.set('a', 1, 0, mesh('a1@0'));
    cache.set('a', 1, 2, mesh('a1@2'));
    cache.set('b', 1, 0, mesh('b1@0'));
    cache.set('a', 2, 0, mesh('a2@0'));
    expect(dropped.sort()).toEqual(['a1@0', 'a1@2']);
    expect(cache.byteLength).toBe(200);
    // A late mesh of an older version is refused.
    cache.set('a', 1, 4, mesh('a1@4'));
    expect(cache.get('a', 1, 4)).toBeUndefined();
    expect(dropped).toContain('a1@4');
  });

  it('replaces a mesh set again for the same key', () => {
    const { cache, dropped } = cacheWithBudget(1000);
    cache.set('a', 1, 0, mesh('first'));
    cache.set('a', 1, 0, mesh('second', 70));
    expect(dropped).toEqual(['first']);
    expect(cache.get('a', 1, 0)?.name).toBe('second');
    expect(cache.byteLength).toBe(70);
  });

  it('stands in with the nearest cached bucket, whatever version is being built', () => {
    const { cache } = cacheWithBudget(1000);
    cache.set('a', 1, -2, mesh('a1@-2'));
    cache.set('a', 1, 4, mesh('a1@4'));
    expect(cache.nearest('a', 3)?.name).toBe('a1@4');
    expect(cache.nearest('a', -1)?.name).toBe('a1@-2');
    // A tie goes to the finer mesh.
    expect(cache.nearest('a', 1)?.name).toBe('a1@4');
    expect(cache.nearest('b', 0)).toBeUndefined();
  });

  it('counts a fallback as drawn this frame', () => {
    const { cache, dropped } = cacheWithBudget(100);
    cache.set('a', 1, 0, mesh('a'));
    cache.beginFrame();
    cache.nearest('a', 2);
    cache.set('b', 1, 0, mesh('b'));
    expect(dropped).toEqual([]);
  });

  it('drops every mesh of a deleted object, and everything on clear', () => {
    const { cache, dropped } = cacheWithBudget(1000);
    cache.set('a', 1, 0, mesh('a@0'));
    cache.set('a', 1, 2, mesh('a@2'));
    cache.set('b', 1, 0, mesh('b@0'));
    cache.deleteObject('a');
    cache.deleteObject('missing');
    expect(dropped.sort()).toEqual(['a@0', 'a@2']);
    expect(cache.byteLength).toBe(100);
    cache.clear();
    expect(dropped).toContain('b@0');
    expect(cache.byteLength).toBe(0);
    expect(cache.size).toBe(0);
  });

  it('rejects a negative budget', () => {
    expect(() => new MeshCache<TestMesh>({ byteBudget: -1 })).toThrow(RangeError);
  });

  it('counts a mesh cached again within a sweep of its eviction as regenerated', () => {
    const { cache } = cacheWithBudget(150);
    cache.beginFrame(1_000);
    cache.set('a', 1, 0, mesh('a1@0'));
    cache.beginFrame(1_016);
    cache.set('b', 1, 0, mesh('b1@0'));
    expect(cache.evictions).toBe(1);
    cache.beginFrame(1_032);
    cache.set('a', 1, 0, mesh('a1@0 again'));
    expect(cache.regenerations).toBe(1);
    // b was evicted at 1 032 ms; built again 8 s and more later, it is ordinary turnover.
    cache.beginFrame(1_032 + REGENERATION_WINDOW_MS + 1);
    cache.set('b', 1, 0, mesh('b1@0 again'));
    expect(cache.regenerations).toBe(1);
  });
});

it('evicts only unpinned departures while retaining the rest of the active epoch', () => {
  const { cache, dropped } = cacheWithBudget(500);
  for (const id of ['a', 'b', 'c']) cache.set(id, 1, 0, mesh(id));
  cache.beginFrame(1, true);
  cache.unpin('b');
  cache.unpin('b');
  cache.unpin('missing');
  cache.set('d', 1, 0, mesh('d', 400));
  expect(dropped).toEqual(['b']);
  expect(cache.byteLength).toBe(600);
  cache.unpin('a');
  cache.trim();
  expect(dropped).toEqual(['b', 'a']);
  expect(cache.byteLength).toBe(500);
  cache.beginFrame(2);
  expect(cache.get('c', 1, 0)?.name).toBe('c');
  cache.set('e', 1, 0, mesh('e'));
  expect(dropped).toEqual(['b', 'a', 'd']);
  expect(cache.byteLength).toBe(200);
  cache.clear();
  expect(cache.size).toBe(0);
});
