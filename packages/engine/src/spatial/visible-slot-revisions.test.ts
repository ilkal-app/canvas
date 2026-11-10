import { expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { FILLED_RECT_PASS } from '../scene/__fixtures__/filled-rect-pass.js';
import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { Scene } from '../scene/scene.js';

import { VisibleSlotPass } from './visible-slot-pass.js';

function fixture() {
  const scene = new Scene([
    {
      ...FILLED_RECT_PASS,
      recordCount: (object) => (object.type === 'shape' ? object.width : 0),
    },
  ]);
  const document = new FakeSceneDocument();
  const ranges = new VisibleSlotPass(0);
  const members = new Set<ObjectId>(['a' as ObjectId, 'b' as ObjectId]);
  const apply = () => scene.apply(document.takeChanges());
  document.create(shapeObject('a', { width: 3 }), shapeObject('b', { width: 2 }));
  apply();
  ranges.update(scene, FILLED_RECT_PASS.name, members, members);
  return { scene, document, ranges, members, apply };
}

it('does not reread stable slot arrays for placement-only changes', () => {
  const { scene, document, ranges, members, apply } = fixture();
  const previous = ranges.latestChange;
  document.update('a', { x: 123 });
  apply();
  const slots = vi.spyOn(scene, 'slotsOf');
  ranges.update(scene, FILLED_RECT_PASS.name, members, members);
  expect(slots).not.toHaveBeenCalled();
  expect(ranges.latestChange).toBe(previous);
  expect(ranges.ranges).toEqual([{ start: 0, count: 5 }]);
});

it('detects in-place slot shrink, deletion and same-ID recreation with reused slots', () => {
  const { scene, document, ranges, members, apply } = fixture();
  const slots = scene.slotsOf('a' as ObjectId, FILLED_RECT_PASS.name);
  document.update('a', { width: 1 });
  apply();
  expect(scene.slotsOf('a' as ObjectId, FILLED_RECT_PASS.name)).toBe(slots);
  ranges.update(scene, FILLED_RECT_PASS.name, members, members);
  expect(ranges.ranges).toEqual([
    { start: 0, count: 1 },
    { start: 3, count: 2 },
  ]);
  document.delete('a');
  apply();
  document.create(shapeObject('a', { width: 2 }));
  apply();
  ranges.update(scene, FILLED_RECT_PASS.name, members, members);
  const expected = [
    ...scene.slotsOf('a' as ObjectId, FILLED_RECT_PASS.name),
    ...scene.slotsOf('b' as ObjectId, FILLED_RECT_PASS.name),
  ].sort((a, b) => a - b);
  expect(
    ranges.ranges.flatMap(({ start, count }) =>
      Array.from({ length: count }, (unused, i) => start + i),
    ),
  ).toEqual(expected);
});

it('removes and restores visibility even when ownership has not changed', () => {
  const { scene, ranges, members } = fixture();
  members.delete('a' as ObjectId);
  ranges.update(scene, FILLED_RECT_PASS.name, members, ['a' as ObjectId]);
  expect(ranges.ranges).toEqual([{ start: 3, count: 2 }]);
  members.add('a' as ObjectId);
  ranges.update(scene, FILLED_RECT_PASS.name, members, ['a' as ObjectId]);
  expect(ranges.ranges).toEqual([{ start: 0, count: 5 }]);
});

it('keeps exact comparison for a custom source without revisions', () => {
  const { scene, document, ranges, members, apply } = fixture();
  const source = {
    slotsOf: scene.slotsOf.bind(scene),
    instanceBufferOf: scene.instanceBufferOf.bind(scene),
    levelOfDetail: scene.levelOfDetail,
  };
  ranges.update(source, FILLED_RECT_PASS.name, members, members);
  document.update('a', { width: 1 });
  apply();
  ranges.update(source, FILLED_RECT_PASS.name, members, members);
  expect(ranges.ranges).toEqual([
    { start: 0, count: 1 },
    { start: 3, count: 2 },
  ]);
});

it('does not reuse revisions across scene replacement', () => {
  const { ranges, members } = fixture();
  const replacement = new Scene([{ ...FILLED_RECT_PASS, recordCount: () => 1 }]);
  const document = new FakeSceneDocument();
  document.create(shapeObject('a'), shapeObject('b'));
  replacement.apply(document.takeChanges());
  ranges.update(replacement, FILLED_RECT_PASS.name, members, members);
  expect(ranges.ranges).toEqual([{ start: 0, count: 2 }]);
});

it('tracks hide and reveal independently of an unchanged slot revision', () => {
  const { scene, ranges, members } = fixture();
  const hidden = new Set<ObjectId>();
  vi.spyOn(scene.levelOfDetail, 'hiddenIn').mockReturnValue(hidden);
  hidden.add('a' as ObjectId);
  ranges.update(scene, FILLED_RECT_PASS.name, members, ['a' as ObjectId]);
  expect(ranges.ranges).toEqual([{ start: 3, count: 2 }]);
  hidden.clear();
  ranges.update(scene, FILLED_RECT_PASS.name, members, ['a' as ObjectId]);
  expect(ranges.ranges).toEqual([{ start: 0, count: 5 }]);
});

it('detects recreated ownership even when ranges never observe the deletion', () => {
  const { scene, document, ranges, members, apply } = fixture();
  document.delete('a');
  apply();
  document.create(shapeObject('other', { width: 3 }));
  apply();
  document.create(shapeObject('a', { width: 3 }));
  apply();
  ranges.update(scene, FILLED_RECT_PASS.name, members, members);
  expect(ranges.ranges).toEqual([{ start: 3, count: 5 }]);
});
