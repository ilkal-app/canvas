import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { RTree } from '../spatial/r-tree.js';

import { imageObject } from './__fixtures__/image-objects.js';
import { ImageIndex } from './image-index.js';

const HERE = { minX: -1, minY: -1, maxX: 200, maxY: 200 };
const AWAY = { minX: 999, minY: -1, maxX: 1200, maxY: 200 };
function target(id = 'image-1', x = 0) {
  return {
    object: imageObject({ id: id as ObjectId }),
    transform: { cos: 1, sin: 0, x, y: 0 },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('ImageIndex pending bounds', () => {
  it('exposes objects and versions immediately and searches a partial batch synchronously', () => {
    const index = new ImageIndex();
    const first = index.track(target());
    expect(index.get('image-1' as ObjectId)).toBe(first);
    expect(index.version).toBe(1);
    expect(index.search(HERE)).toEqual([first]);
    const moved = index.track(target('image-1', 1000));
    expect(index.version).toBe(2);
    expect(index.search(HERE)).toEqual([]);
    expect(index.search(AWAY)).toEqual([moved]);
    const second = index.track(target('image-2'));
    expect(index.search(HERE)).toEqual([second]);
    expect(index.search(AWAY)).toEqual([moved]);
  });

  it('uses the latest of repeated updates and keeps no-op target identity', () => {
    const index = new ImageIndex();
    index.track(target());
    index.track(target('image-1', 500));
    const latest = target('image-1', 1000);
    const tracked = index.track(latest);
    expect(index.track(latest)).toBe(tracked);
    expect(index.version).toBe(3);
    expect(index.search(HERE)).toEqual([]);
    expect(index.search(AWAY)).toEqual([tracked]);
  });

  it('forgets pending and indexed bounds before recreation', () => {
    const index = new ImageIndex();
    const id = 'image-1' as ObjectId;
    index.track(target());
    index.forget(id);
    expect(index.search(HERE)).toEqual([]);
    index.track(target());
    index.search(HERE);
    const moved = index.track(target('image-1', 1000));
    expect(index.forget(id)).toBe(moved);
    const recreated = index.track(target());
    expect(index.version).toBe(6);
    expect(index.search(HERE)).toEqual([recreated]);
    expect(index.search(AWAY)).toEqual([]);
  });

  it('copies queued bounds before returning the externally reachable tracked image', () => {
    const index = new ImageIndex();
    const tracked = index.track(target());
    if (tracked === undefined) throw new Error('Expected a tracked image');
    Object.assign(tracked.bounds, AWAY);
    expect(index.search(HERE)).toEqual([tracked]);
    expect(index.search(AWAY)).toEqual([]);
  });

  it('throws at track and preserves the previous searchable bounds and revision', () => {
    const index = new ImageIndex();
    index.track(target());
    const invalid = target('image-1', Number.NaN);
    expect(() => index.track(invalid)).toThrow(RangeError);
    expect(index.version).toBe(1);
    // The existing contract stores the tracked value before RTree validation throws.
    expect(index.get(invalid.object.id)?.transform).toBe(invalid.transform);
    expect(index.search(HERE)).toEqual([index.get(invalid.object.id)]);
    expect(index.search(AWAY)).toEqual([]);
    index.forget(invalid.object.id);
    expect(index.search(HERE)).toEqual([]);
  });

  it('matches eager queries through region crossings, updates, deletion and recreation', () => {
    const lazy = new ImageIndex();
    const eager = new ImageIndex();
    for (let step = 0; step < 12; step += 1) {
      for (let n = 0; n < 20; n += 1) {
        const next = target(`image-${String(n)}`, (step + n) % 2 ? 1000 : 0);
        for (const index of [lazy, eager]) {
          if ((step + n) % 5 === 0) index.forget(next.object.id);
          else index.track(next);
        }
        eager.search(HERE);
      }
      for (const region of [HERE, AWAY]) {
        const ids = (index: ImageIndex) =>
          index
            .search(region)
            .map(({ object }) => object.id)
            .sort();
        expect(ids(lazy)).toEqual(ids(eager));
      }
      expect(lazy.version).toBe(eager.version);
    }
  });

  it('refits a dense move without individually removing and reinserting every image', () => {
    const index = new ImageIndex();
    for (let n = 0; n < 100; n += 1) index.track(target(`image-${String(n)}`, n));
    index.search(HERE);
    const updates = vi.spyOn(RTree.prototype, 'update');
    const removals = vi.spyOn(RTree.prototype, 'remove');
    for (let n = 0; n < 100; n += 1) index.track(target(`image-${String(n)}`, n + 1000));
    expect(index.search(HERE)).toEqual([]);
    expect(index.search(AWAY)).toHaveLength(100);
    expect(updates).not.toHaveBeenCalled();
    expect(removals).not.toHaveBeenCalled();
  });
});
