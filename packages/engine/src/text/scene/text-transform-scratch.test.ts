import { expect, it, vi } from 'vitest';

import { CAMERA, createTextSetUp, textObject } from './__fixtures__/text-objects.js';
import { TEXT_PASS_NAME } from './text-pass.js';

it('borrows transform storage without allocating per moved text and consumes each object separately', async () => {
  const { renderer, document, settle, records } = createTextSetUp();
  document.create(textObject('a', 'AB'), textObject('b', 'CD', { x: 40, y: 30 }));
  renderer.enqueue(document.takeChanges());
  await settle();
  const allocate = vi.spyOn(Float32Array, 'of');
  try {
    document.update('a', { x: 12.125, y: -8.25, rotation: 0.3 });
    document.update('b', { x: -31.5, y: 22.75, rotation: -0.7 });
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 2000, camera: CAMERA });
    expect(allocate).not.toHaveBeenCalled();
  } finally {
    allocate.mockRestore();
  }
  const patched = records().map((record) => [...record]);
  expect(patched[0]?.[0]).toBe(12.125);
  expect(patched[2]?.[0]).toBe(-31.5);
  const pass = renderer.scene.passes.find(({ name }) => name === TEXT_PASS_NAME);
  if (pass === undefined) throw new Error('Missing text pass');
  pass.preparePatch = () => undefined;
  document.update('a', { x: 12.125 });
  document.update('b', { x: -31.5 });
  renderer.enqueue(document.takeChanges());
  renderer.renderFrame({ timeMs: 2016, camera: CAMERA });
  expect(records().map((record) => [...record])).toEqual(patched);
  renderer.destroy();
});
