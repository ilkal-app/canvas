import { describe, expect, it } from 'vitest';

import { compareSiblings, isValidKey, type ObjectId } from '@canvas/schema';

import { sortTopmostFirst } from '../../spatial/paint-order.js';
import { shapeObject, sourceOf } from '../__fixtures__/scene-objects.js';

import {
  SIBLING_ORDER_FIXTURE,
  SIBLING_ORDER_FIXTURE_BOTTOM_UP,
} from './__fixtures__/sibling-order-fixture.js';
import { paintOrderOf, type StackedObject } from './paint-order.js';
import { compareStacking } from './stacking-order.js';

// The document package orders siblings with the schema's `compareSiblings` (`sortedSiblings`,
// `topChildOf`, reorders); the engine may import only the schema, so this is where the two are
// checked against each other.
describe('sibling order shared by the schema and the engine', () => {
  const bottomUp = [...SIBLING_ORDER_FIXTURE].sort(compareSiblings).map(({ id }) => id);

  it("sorts the fixture with the schema's compareSiblings as worked out by hand", () => {
    expect(SIBLING_ORDER_FIXTURE.every(({ z }) => isValidKey(z))).toBe(true);
    expect(bottomUp).toEqual(SIBLING_ORDER_FIXTURE_BOTTOM_UP);
  });

  it('stacks siblings with compareStacking exactly as compareSiblings does', () => {
    for (const first of SIBLING_ORDER_FIXTURE) {
      for (const second of SIBLING_ORDER_FIXTURE) {
        expect(Math.sign(compareStacking(first, second))).toBe(
          Math.sign(compareSiblings(first, second)),
        );
      }
    }
  });

  it('paints the fixture in z-order segments bottom to top in the schema order', () => {
    const objects = SIBLING_ORDER_FIXTURE.map((sibling) => ({ ...sibling, parentId: null }));
    expect(paintOrderOf(objects)).toEqual(bottomUp);
  });

  it('paints the same fixture inside a frame in the schema order, after the frame', () => {
    const frameId = 'frame' as ObjectId;
    const objects: StackedObject[] = [
      { id: frameId, z: 'a0', parentId: null },
      ...SIBLING_ORDER_FIXTURE.map((sibling) => ({ ...sibling, parentId: frameId })),
    ];
    expect(paintOrderOf(objects)).toEqual(['frame', ...bottomUp]);
  });

  it('picks the fixture topmost first, the reverse of the schema order', () => {
    const source = sourceOf(SIBLING_ORDER_FIXTURE.map(({ id, z }) => shapeObject(id, { z })));
    const ids = SIBLING_ORDER_FIXTURE.map(({ id }) => id);
    expect(sortTopmostFirst(ids, source)).toEqual([...bottomUp].reverse());
  });
});
