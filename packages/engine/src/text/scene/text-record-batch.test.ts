import { expect, it, vi } from 'vitest';

import type { BoardObject } from '@canvas/schema';

import { enableRecordBatches } from '../../scene/record-batches.js';
import type { SceneObject } from '../../scene/scene-pass.js';

import { CAMERA, createTextSetUp, textObject } from './__fixtures__/text-objects.js';

it('resolves each object once and preserves exact records/pages through resource and LOD changes', async () => {
  const control = createTextSetUp();
  const batched = createTextSetUp();
  const pass = batched.renderer.scene.passes[0];
  if (!pass) throw new Error('Missing text pass');
  enableRecordBatches([pass]);
  const lookup = vi.spyOn(
    pass as unknown as { entryFor(target: SceneObject): unknown },
    'entryFor',
  );
  const compare = () => {
    expect(batched.records()).toEqual(control.records());
    expect(batched.renderer.scene.pagesOf('text')).toEqual(control.renderer.scene.pagesOf('text'));
  };
  const load = (object: BoardObject) => {
    for (const setup of [control, batched]) {
      setup.document.create(object);
      setup.renderer.enqueue(setup.document.takeChanges());
      setup.renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    }
  };
  load(textObject('label', 'Batch every glyph exactly', { x: 7.125, rotation: 0.375 }));
  expect(lookup).toHaveBeenCalledOnce();
  compare();
  await control.settle();
  await batched.settle();
  compare();
  for (const zoom of [0.01, 1, 3]) {
    const camera = { ...CAMERA, zoom };
    await control.settle(20, camera);
    await batched.settle(20, camera);
    compare();
  }
  load(textObject('label', 'Replacement text', { x: -11.75, rotation: -0.625 }));
  await control.settle();
  await batched.settle();
  compare();
  for (const setup of [control, batched]) {
    setup.renderer.destroy();
    setup.pool.terminate();
  }
});
