import { expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { mapSource, rect } from './__fixtures__/select-board.js';
import { SelectionFarCache } from './selection-far-cache.js';
import { selectionFrameOf } from './selection-frame.js';

it('reads a dense change list once instead of once for every selected leaf', () => {
  const objects = Array.from({ length: 200 }, (unused, index) =>
    rect(`r${String(index)}`, null, { x: index * 20, y: 0, width: 10, height: 10 }),
  );
  const entries = new Map(objects.map((object) => [object.id, object]));
  const source = { ...mapSource(objects), get: (id: ObjectId) => entries.get(id) };
  const cache = new SelectionFarCache(source);
  const ids = objects.map((object) => object.id);
  cache.frame(ids);
  for (const object of objects) entries.set(object.id, { ...object, x: object.x + 50 });
  let reads = 0;
  const updated = new Proxy(ids, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/u.test(key)) reads += 1;
      return Reflect.get(target, key, receiver) as unknown;
    },
  });
  cache.invalidate({ created: [], updated, deleted: [] });
  expect(reads).toBeLessThanOrEqual(ids.length * 2);
  expect(cache.frame(ids)).toEqual(selectionFrameOf(ids, source));
});
