import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { WorldBounds } from '../camera/camera.js';
import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';

import { randomBox, seededRandom } from './__fixtures__/random-boxes.js';
import { SceneSpatialIndex } from './scene-spatial-index.js';

/**
 * Sorts results because spatial searches have no specified traversal order.
 *
 * @param ids - Search results.
 * @returns Ids in lexical order.
 */
function sorted(ids: readonly ObjectId[]): string[] {
  return [...ids].sort();
}

/**
 * Builds one deterministic board of root shapes with varied world positions.
 *
 * @param count - Number of shapes.
 * @returns Shapes at seeded positions.
 */
function boardShapes(count: number): ReturnType<typeof shapeObject>[] {
  const random = seededRandom(530);
  const objects: ReturnType<typeof shapeObject>[] = [];
  for (let index = 0; index < count; index += 1) {
    objects.push(
      shapeObject(`shape-${String(index)}`, {
        x: random() * 10_000,
        y: random() * 10_000,
      }),
    );
  }
  return objects;
}

/**
 * Checks public rectangle queries against the same board indexed in one change set.
 *
 * @param batched - Index that received two change sets.
 * @param fresh - Index that received one change set.
 * @param queries - Deterministic query boxes.
 */
function expectSearchesAgree(
  batched: SceneSpatialIndex,
  fresh: SceneSpatialIndex,
  queries: readonly WorldBounds[],
): void {
  for (const query of queries) {
    expect(sorted(batched.searchRect(query))).toEqual(sorted(fresh.searchRect(query)));
  }
}

describe('SceneSpatialIndex batch load acceptance', () => {
  it('searches like a single-load index when a later created batch outnumbers the indexed objects', () => {
    const objects = boardShapes(10_000);
    const document = new FakeSceneDocument();
    const batched = new SceneSpatialIndex();
    document.create(...objects.slice(0, 1_000));
    batched.apply(document.takeChanges());
    document.create(...objects.slice(1_000));
    batched.apply(document.takeChanges());

    const singleDocument = new FakeSceneDocument();
    const fresh = new SceneSpatialIndex();
    singleDocument.create(...objects);
    fresh.apply(singleDocument.takeChanges());

    expect(batched.size).toBe(objects.length);
    expect(batched.validate()).toEqual([]);
    expect(fresh.validate()).toEqual([]);
    for (const object of objects)
      expect(batched.boundsOf(object.id)).toEqual(fresh.boundsOf(object.id));
    const random = seededRandom(531);
    const queries = Array.from({ length: 30 }, () => randomBox(random, 10_000, 1_500));
    expectSearchesAgree(batched, fresh, queries);
  });
});
