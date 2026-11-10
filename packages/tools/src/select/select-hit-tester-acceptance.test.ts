import { describe, expect, it } from 'vitest';

import type { ShapeObject } from '@canvas/schema';

import { frame, indexOf, mapSource, rect } from './__fixtures__/select-board.js';
import { createSelectHitTester } from './select-hit-tester.js';

// The spatial index is built from ordinary objects; only the exact-geometry read is poisoned.
describe('frame lookup acceptance', () => {
  it('tests frame geometry without testing a leaf under the same point', () => {
    const objects = [
      frame('back', null, { x: 0, y: 0, width: 200, height: 200 }),
      { ...frame('front', null, { x: 0, y: 0, width: 200, height: 200 }), z: 'a1' },
      { ...rect('leaf', null, { x: 10, y: 10, width: 40, height: 40 }), z: 'a2' },
    ];
    const base = mapSource(objects);
    const source = {
      get: (objectId: Parameters<typeof base.get>[0]) => {
        const object = base.get(objectId);
        if (object?.id !== 'leaf') return object;
        return new Proxy(object as ShapeObject, {
          get(target, property, receiver) {
            if (property === 'kind') throw new Error('leaf exact geometry was tested');
            return Reflect.get(target, property, receiver) as unknown;
          },
        });
      },
      childrenOf: (objectId: Parameters<typeof base.childrenOf>[0]) => base.childrenOf(objectId),
    };
    const hits = createSelectHitTester(indexOf(objects), source);
    expect(hits.frameAt({ x: 25, y: 25 }, (frameId) => frameId !== 'front')).toBe('back');
  });
});
