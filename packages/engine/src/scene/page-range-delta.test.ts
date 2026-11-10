import { describe, expect, it } from 'vitest';

import { FILLED_RECT_PASS } from './__fixtures__/filled-rect-pass.js';
import { FakeSceneDocument, shapeObject } from './__fixtures__/scene-objects.js';
import { PageRangeCache } from './page-range-cache.js';
import { splitRangesByPage } from './page-split.js';
import { Scene } from './scene.js';

/**
 * Builds a paged scene and a page table counting numeric reads.
 *
 * @returns The scene, counted table and read counter.
 * @throws {Error} If the fixture has no page table.
 */
function paged() {
  const scene = new Scene([
    {
      ...FILLED_RECT_PASS,
      name: 'paged',
      pageOf: ({ object }) => (object.type === 'shape' ? object.cornerRadius : 0),
      pageEntries: () => [],
    },
  ]);
  const document = new FakeSceneDocument();
  for (let index = 0; index < 500; index += 1) {
    document.create(shapeObject(`s${String(index)}`, { cornerRadius: index % 3 }));
  }
  scene.apply(document.takeChanges());
  const raw = scene.pagesOf('paged');
  if (!raw) throw new Error('No page table.');
  const count = { reads: 0 };
  const pages = new Proxy(raw, {
    get(target, key) {
      if (typeof key === 'string' && /^\d+$/.test(key)) count.reads += 1;
      return Reflect.get(target, key, target) as unknown;
    },
  });
  return { scene, raw, pages, count };
}

describe('incremental page partitioning', () => {
  it('reads only newly drawn slots, including gap bridges, and removes slots without page reads', () => {
    const { scene, raw, pages, count } = paged();
    const cache = new PageRangeCache();
    const source = {};
    cache.split(scene, 'paged', [{ start: 0, count: 400 }], pages, {
      source,
      revision: 1,
      previousRevision: 0,
      added: [{ start: 0, count: 400 }],
      removed: [],
    });
    count.reads = 0;
    const ranges = [{ start: 10, count: 400 }];
    const split = cache.split(scene, 'paged', ranges, pages, {
      source,
      revision: 2,
      previousRevision: 1,
      added: [{ start: 400, count: 10 }],
      removed: [{ start: 0, count: 10 }],
    });
    expect(split).toEqual(splitRangesByPage(ranges, raw));
    expect(count.reads).toBe(10);
    count.reads = 0;
    const smaller = [{ start: 20, count: 390 }];
    expect(
      cache.split(scene, 'paged', smaller, pages, {
        source,
        revision: 3,
        previousRevision: 2,
        added: [],
        removed: [{ start: 10, count: 10 }],
      }),
    ).toEqual(splitRangesByPage(smaller, raw));
    expect(count.reads).toBe(0);
  });

  it('rebuilds after skipped revisions or provider changes', () => {
    const { scene, raw, pages } = paged();
    const cache = new PageRangeCache();
    const source = {};
    cache.split(scene, 'paged', [{ start: 0, count: 40 }], pages, {
      source,
      revision: 1,
      previousRevision: 0,
      added: [],
      removed: [],
    });
    const ranges = [{ start: 100, count: 30 }];
    expect(
      cache.split(scene, 'paged', ranges, pages, {
        source,
        revision: 4,
        previousRevision: 3,
        added: [],
        removed: [],
      }),
    ).toEqual(splitRangesByPage(ranges, raw));
    const replaced = [{ start: 200, count: 20 }];
    expect(
      cache.split(scene, 'paged', replaced, pages, {
        source: {},
        revision: 5,
        previousRevision: 4,
        added: [],
        removed: [],
      }),
    ).toEqual(splitRangesByPage(replaced, raw));
  });
});
