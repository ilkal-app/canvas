import { expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { FILLED_RECT_PASS } from '../scene/__fixtures__/filled-rect-pass.js';
import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { Scene } from '../scene/scene.js';

import { SpatialCuller } from './spatial-culler.js';
import { visibleRanges } from './visible-ranges.js';

const VIEW = { minX: 0, minY: 0, maxX: 200, maxY: 100 };
const PASS = FILLED_RECT_PASS.name;

type CompactableScene = Scene & {
  compactSlots(passName: string, ids: readonly ObjectId[]): number;
};

function covered(ranges: readonly { start: number; count: number }[]): number[] {
  return ranges.flatMap(({ start, count }) =>
    Array.from({ length: count }, (unused, index) => start + index),
  );
}

it('publishes compacted visible ranges and a delta that patches to the next membership', () => {
  const scene = new Scene([FILLED_RECT_PASS]) as CompactableScene;
  const culler = new SpatialCuller({ paddingFraction: 0, maxGapRecords: 0 });
  const document = new FakeSceneDocument();
  document.create(
    shapeObject('c', { x: 0 }),
    shapeObject('offscreen', { x: 1_000 }),
    shapeObject('b', { x: 20 }),
    shapeObject('a', { x: 40 }),
  );
  const created = document.takeChanges();
  scene.apply(created);
  culler.applyChanges(created);
  culler.cull(scene, VIEW);
  scene.compactSlots(PASS, ['a', 'b', 'c'] as ObjectId[]);
  const after = culler.cull(scene, VIEW).get(PASS) ?? [];
  expect(after).toEqual(visibleRanges(scene, culler.visibleIdsFor(VIEW), false, 0).get(PASS));
  document.update('a', { x: 1_000 });
  const moved = document.takeChanges();
  scene.apply(moved);
  culler.applyChanges(moved);
  const next = culler.cull(scene, VIEW).get(PASS) ?? [];
  const delta = culler.rangeChangeOf(PASS);
  expect(delta).toBeDefined();
  const patched = new Set(covered(after));
  for (const slot of covered(delta?.removed ?? [])) patched.delete(slot);
  for (const slot of covered(delta?.added ?? [])) patched.add(slot);
  expect([...patched].sort((left, right) => left - right)).toEqual(covered(next));
});
