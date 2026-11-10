import { expect, it, vi } from 'vitest';

import { FILLED_RECT_PASS } from '../__fixtures__/filled-rect-pass.js';
import { FakeSceneDocument, shapeObject } from '../__fixtures__/scene-objects.js';
import { markRootMoveChanges } from '../root-move-changes.js';

import { ZOrderMirror } from './z-order-mirror.js';

it('preserves order inputs without reevaluating explicitly translation-stable passes', () => {
  const document = new FakeSceneDocument();
  document.create(shapeObject('a'));
  const recordCount = vi.fn((object: ReturnType<typeof shapeObject>) =>
    FILLED_RECT_PASS.recordCount(object),
  );
  const isOccluder = vi.fn(() => true);
  const pass = { ...FILLED_RECT_PASS, isRootMoveOrderStable: true, recordCount, isOccluder };
  const mirror = new ZOrderMirror();
  mirror.observe(document.takeChanges(), [pass]);
  mirror.clearDirty();
  recordCount.mockClear();
  isOccluder.mockClear();
  document.update('a', { x: 40, y: -20 });
  const changes = markRootMoveChanges(document.takeChanges());
  mirror.observe(changes, [pass]);
  expect(recordCount).not.toHaveBeenCalled();
  expect(isOccluder).not.toHaveBeenCalled();
  expect(mirror.get(shapeObject('a').id)?.x).toBe(40);
  expect([...mirror.updatedIds]).toEqual(['a']);
  expect([mirror.isOrderDirty, mirror.isSlotsDirty, mirror.isOccludersDirty]).toEqual([
    false,
    false,
    false,
  ]);
});

it('keeps custom position-dependent pass checks and ordinary geometry changes', () => {
  const document = new FakeSceneDocument();
  document.create(shapeObject('a'));
  const pass = {
    ...FILLED_RECT_PASS,
    isRootMoveOrderStable: false,
    recordCount: (object: ReturnType<typeof shapeObject>) => (object.x > 10 ? 2 : 1),
    isOccluder: (object: ReturnType<typeof shapeObject>) => object.x > 10,
  };
  const mirror = new ZOrderMirror();
  mirror.observe(document.takeChanges(), [pass]);
  mirror.clearDirty();
  document.update('a', { x: 40 });
  mirror.observe(markRootMoveChanges(document.takeChanges()), [pass]);
  expect(mirror.isSlotsDirty).toBe(true);
  expect(mirror.isOccludersDirty).toBe(true);
  mirror.clearDirty();
  const stable = {
    ...FILLED_RECT_PASS,
    isRootMoveOrderStable: true,
    recordCount: vi.fn((object: ReturnType<typeof shapeObject>) =>
      FILLED_RECT_PASS.recordCount(object),
    ),
  };
  document.update('a', { fill: null });
  mirror.observe(document.takeChanges(), [stable]);
  expect(stable.recordCount).toHaveBeenCalled();
});
