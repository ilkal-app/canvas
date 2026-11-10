import { expect, it } from 'vitest';

import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { canUseRootMoveBatch } from '../scene/root-move-batch-guards.js';
import { withRootMoveBatch } from '../scene/root-move-batch.js';
import { markRootMoveChanges } from '../scene/root-move-changes.js';
import { Scene } from '../scene/scene.js';
import { worldTransformOf } from '../scene/world-transform.js';

import { imageObject } from './__fixtures__/image-objects.js';
import { flushMicrotasks, ManualJobRunner } from './__fixtures__/manual-job-runner.js';
import { pendingImageAssetInfo, type AssetSource } from './asset-source.js';
import { createFixtureAssetSource, fixtureAssetId } from './fixture-asset-source.js';
import { createImagePassSupport } from './image-pass-support.js';
import { IMAGE_PASS } from './image-pass.js';

function setup(assets: AssetSource = createFixtureAssetSource(2)) {
  const backend = new FakeGpuBackend();
  const images = createImagePassSupport(assets, new ManualJobRunner(), 8192);
  const pass = IMAGE_PASS.create({ backend, images, now: () => 0, requestFrame: () => undefined });
  const object = imageObject();
  const track = () => {
    pass.prepare(
      new Float32Array(pass.layout.floatsPerRecord),
      {
        object,
        transform: worldTransformOf(object, { get: () => undefined }),
      },
      0,
    );
  };
  const close = () => {
    pass.destroy?.();
    images.catalogue.destroy();
  };
  return { pass, object, images, track, close };
}

it('admits only tracked images with the same fully described asset', async () => {
  const { pass, object, images, track, close } = setup();
  try {
    expect(canUseRootMoveBatch([pass], [shapeObject('shape')])).toBe(true);
    expect(canUseRootMoveBatch([pass], [object])).toBe(false);
    track();
    expect(canUseRootMoveBatch([pass], [object])).toBe(false);
    await flushMicrotasks();
    expect(images.catalogue.peek(object.assetId)?.status).toBe('described');
    expect(canUseRootMoveBatch([pass], [{ ...object, x: 22.25 }])).toBe(true);
    expect(canUseRootMoveBatch([pass], [{ ...object, assetId: fixtureAssetId('other') }])).toBe(
      false,
    );
    const entry = images.catalogue.peek(object.assetId);
    if (!entry) throw new Error('Missing catalogue entry');
    entry.status = 'failed';
    expect(canUseRootMoveBatch([pass], [object])).toBe(false);
    entry.status = 'described';
    pass.forget?.(object.id);
    expect(canUseRootMoveBatch([pass], [object])).toBe(false);
  } finally {
    close();
  }
});

it('preserves live later-member reads when a pending asset synchronously revives', async () => {
  let revive = () => undefined;
  const assets = {
    ...createFixtureAssetSource(2),
    describe: () => Promise.resolve(pendingImageAssetInfo()),
    revive: () => {
      revive();
    },
  };
  const { pass, object, close } = setup(assets);
  const document = new FakeSceneDocument();
  const scene = new Scene([pass]);
  document.create(object, shapeObject('later'));
  scene.apply(document.takeChanges());
  await flushMicrotasks();
  const seen: number[] = [];
  scene.useRetainedMove((target) => {
    pass.retainMoveTarget?.(target);
    seen.push(target.object.x);
    return true;
  });
  document.update(object.id, { x: 5 });
  document.update('later', { x: 10 });
  const changes = markRootMoveChanges(document.takeChanges());
  const objects = changes.updated.map((id) => {
    const current = changes.get(id);
    if (!current) throw new Error('Missing fixture');
    return current;
  });
  revive = () => {
    document.update('later', { x: 99 });
  };
  try {
    if (canUseRootMoveBatch([pass], objects))
      withRootMoveBatch(changes, objects, () => scene.apply(changes));
    else scene.apply(changes);
    expect(seen).toEqual([5, 99]);
  } finally {
    close();
  }
});
