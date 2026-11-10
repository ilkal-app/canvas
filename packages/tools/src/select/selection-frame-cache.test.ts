import { describe, expect, it, vi } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { group, id, mapSource, rect } from './__fixtures__/select-board.js';
import { selectionScopeOf } from './far-objects.js';
import { SelectionFrameCache } from './selection-frame-cache.js';
import { selectionFrameOf } from './selection-frame.js';
import { isResizable, type SelectionSource } from './selection-geometry.js';

function mutableSource(objects: readonly BoardObject[]) {
  const entries = new Map(objects.map((object) => [object.id, object]));
  const childrenOf = vi.fn((parent: ObjectId) =>
    [...entries.values()].filter((object) => object.parentId === parent).map(({ id }) => id),
  );
  const source: SelectionSource = { get: (key) => entries.get(key), childrenOf };
  return { entries, source, childrenOf };
}

function expectFresh(
  cache: SelectionFrameCache,
  ids: readonly ObjectId[],
  source: SelectionSource,
) {
  const scope = selectionScopeOf(ids, source);
  expect(cache.scope()).toEqual(scope);
  expect(cache.frame()).toEqual(selectionFrameOf(ids, source, scope.far));
  expect(cache.canResize()).toEqual(isResizable(ids, source, scope.far));
}

describe('selection geometry after a related change', () => {
  it('rechecks the changed object without walking every unchanged selected subtree', () => {
    const objects = Array.from({ length: 100 }, (unused, index) =>
      rect(`r${String(index)}`, null, { x: index * 20, y: 0, width: 10, height: 10 }),
    );
    const { entries, source, childrenOf } = mutableSource(objects);
    const cache = new SelectionFrameCache(source);
    const ids = objects.map(({ id }) => id);
    cache.select(ids);
    cache.frame();
    cache.canResize();
    childrenOf.mockClear();
    const first = objects[0];
    if (!first) throw new Error('Missing fixture rectangle');
    entries.set(first.id, { ...first, x: 100 });
    expect(cache.isAffectedBy({ created: [], updated: [id('r0')], deleted: [] })).toBe(true);
    cache.frame();
    cache.canResize();
    expect(childrenOf).toHaveBeenCalledTimes(1);
    expectFresh(cache, ids, source);
  });

  it('reuses unchanged oriented boxes when rebuilding the aggregate frame', () => {
    const objects = Array.from({ length: 100 }, (unused, index) =>
      rect(`r${String(index)}`, null, { x: index * 20, y: 0, width: 10, height: 10 }),
    );
    const { entries, source } = mutableSource(objects);
    const isDrawable = vi.fn(() => true);
    const gatedSource = { ...source, isDrawable };
    const ids = objects.map(({ id }) => id);
    const cache = new SelectionFrameCache(gatedSource);
    cache.select(ids);
    cache.frame();
    const first = objects[0];
    if (!first) throw new Error('Missing fixture rectangle');
    entries.set(first.id, { ...first, x: -40, rotation: 0.5 });
    cache.isAffectedBy({ created: [], updated: [first.id], deleted: [] });
    cache.scope();
    isDrawable.mockClear();
    cache.frame();
    expect(isDrawable).toHaveBeenCalledTimes(1);
    expectFresh(cache, ids, gatedSource);
  });

  it('invalidates descendants when their ancestor moves and a reparented selection afterwards', () => {
    const a = group('a', null, 10, 20);
    const b = group('b', null, -100, 30);
    const child = rect('child', 'a', { x: 0, y: 0, width: 10, height: 10, rotation: 0.7 });
    const other = rect('other', null, { x: 200, y: 0, width: 10, height: 10 });
    const { entries, source } = mutableSource([a, b, child, other]);
    const ids = [child.id, other.id];
    const cache = new SelectionFrameCache(source);
    cache.select(ids);
    expectFresh(cache, ids, source);
    for (const object of [
      { ...a, rotation: 0.3 },
      { ...child, parentId: b.id },
      { ...b, x: 80 },
    ]) {
      entries.set(object.id, object);
      cache.isAffectedBy({ created: [], updated: [object.id], deleted: [] });
      expectFresh(cache, ids, source);
    }
  });

  it('refreshes a selected group for arriving, leaving, deleted and far children', () => {
    const parent = group('g', null, 0, 0);
    const child = rect('child', 'g', { x: 0, y: 0, width: 10, height: 10 });
    const { entries, source } = mutableSource([parent, child]);
    const ids = [parent.id];
    const cache = new SelectionFrameCache(source);
    cache.select(ids);
    expectFresh(cache, ids, source);
    const arriving = rect('arrival', 'g', { x: 800, y: 0, width: 10, height: 10 });
    entries.set(arriving.id, arriving);
    cache.isAffectedBy({ created: [arriving.id], updated: [], deleted: [] });
    expectFresh(cache, ids, source);
    for (const object of [
      { ...arriving, x: 1e300 },
      { ...arriving, parentId: null },
    ]) {
      entries.set(object.id, object);
      cache.isAffectedBy({ created: [], updated: [object.id], deleted: [] });
      expectFresh(cache, ids, source);
    }
    entries.delete(child.id);
    cache.isAffectedBy({ created: [], updated: [], deleted: [child.id] });
    expectFresh(cache, ids, source);
  });

  it('keeps the one near box rotated when the rest are far and clears on explicit invalidation', () => {
    const near = rect('near', null, { x: 0, y: 0, width: 10, height: 10, rotation: 0.8 });
    const far = rect('far', null, { x: 1e300, y: 0, width: 10, height: 10 });
    const source = mapSource([near, far]);
    const drawable = vi.fn(() => true);
    const gated = { ...source, isDrawable: drawable };
    const cache = new SelectionFrameCache(gated);
    const ids = [near.id, far.id];
    cache.select(ids);
    expectFresh(cache, ids, gated);
    expect(cache.frame()?.rotation).toBe(near.rotation);
    drawable.mockReturnValue(false);
    cache.invalidate();
    expectFresh(cache, ids, gated);
    expect(cache.frame()).toBeUndefined();
  });
});
