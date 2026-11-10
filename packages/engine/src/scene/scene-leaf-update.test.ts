import { expect, it, vi } from 'vitest';

import { FILLED_RECT_PASS } from './__fixtures__/filled-rect-pass.js';
import { FakeSceneDocument, shapeObject } from './__fixtures__/scene-objects.js';
import { Scene } from './scene.js';

it('does not allocate and iterate an empty descendant frontier for every root leaf', () => {
  const scene = new Scene([FILLED_RECT_PASS]);
  const document = new FakeSceneDocument();
  const objects = Array.from({ length: 100 }, (unused, index) => shapeObject(`r${String(index)}`));
  document.create(...objects);
  scene.apply(document.takeChanges());
  for (const object of objects) document.update(object.id, { x: 20 });
  const changes = document.takeChanges();
  const original = Array.prototype[Symbol.iterator];
  let emptyIterations = 0;
  const iterator = vi.spyOn(Array.prototype, Symbol.iterator).mockImplementation(function (
    this: unknown[],
  ) {
    if (this.length === 0) emptyIterations++;
    return original.call(this);
  });
  let updated: number;
  try {
    updated = scene.apply(changes);
  } finally {
    iterator.mockRestore();
  }
  expect(updated).toBe(objects.length);
  expect(emptyIterations).toBeLessThanOrEqual(4);
});
