import { afterEach, expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { FILLED_RECT_PASS } from './__fixtures__/filled-rect-pass.js';
import { FakeSceneDocument, shapeObject } from './__fixtures__/scene-objects.js';
import { Scene } from './scene.js';

afterEach(() => vi.restoreAllMocks());

it('rewrites stable records without allocating discarded slot arrays', () => {
  const scene = new Scene([FILLED_RECT_PASS]);
  const document = new FakeSceneDocument();
  document.create(shapeObject('a'));
  scene.apply(document.takeChanges());
  const slots = scene.slotsOf('a' as ObjectId, FILLED_RECT_PASS.name);
  const splice = vi.spyOn(slots as number[], 'splice');
  document.update('a', { x: 200 });
  scene.apply(document.takeChanges());
  expect(splice).not.toHaveBeenCalled();
  expect(scene.slotsOf('a' as ObjectId, FILLED_RECT_PASS.name)).toBe(slots);
  expect(scene.instanceBufferOf(FILLED_RECT_PASS.name).data[0]).toBe(200);
});

it('still asks custom passes for every record count and forgets only released membership', () => {
  const recordCount = vi.fn(FILLED_RECT_PASS.recordCount.bind(FILLED_RECT_PASS));
  const prepare = vi.fn(FILLED_RECT_PASS.prepare.bind(FILLED_RECT_PASS));
  const forget = vi.fn();
  const scene = new Scene([{ ...FILLED_RECT_PASS, recordCount, prepare, forget }]);
  const document = new FakeSceneDocument();
  document.create(shapeObject('a', { fill: null }));
  scene.apply(document.takeChanges());
  document.update('a', { x: 200 });
  scene.apply(document.takeChanges());
  expect(recordCount).toHaveBeenCalledTimes(2);
  expect(prepare).not.toHaveBeenCalled();
  expect(forget).not.toHaveBeenCalled();
  document.update('a', { fill: [1, 0, 0, 1] });
  scene.apply(document.takeChanges());
  expect(prepare).toHaveBeenCalledTimes(1);
  const slots = scene.slotsOf('a' as ObjectId, FILLED_RECT_PASS.name);
  expect(slots).toHaveLength(1);
  document.update('a', { fill: null });
  scene.apply(document.takeChanges());
  expect(slots).toEqual([]);
  expect(forget).toHaveBeenCalledExactlyOnceWith('a');
  document.delete('a');
  scene.apply(document.takeChanges());
  expect(forget).toHaveBeenCalledTimes(1);
  expect(recordCount).toHaveBeenCalledTimes(4);
});
