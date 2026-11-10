import { expect, it, vi } from 'vitest';

import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';

import {
  FakeCanvas,
  FakeHostPlatform,
  ReadableFakeGpuBackend,
} from './__fixtures__/fake-host-platform.js';
import { EngineRuntime } from './engine-runtime.js';
import { serializeChangeSet } from './serializable-change-set.js';

it('refuses a projection when a synchronous draw callback queues a newer document change', async () => {
  const platform = new FakeHostPlatform();
  const canvas = new FakeCanvas(100, 100);
  const backend = new ReadableFakeGpuBackend(canvas);
  const runtime = new EngineRuntime(
    backend,
    canvas,
    platform,
    {},
    {
      onFrame: () => undefined,
      onFault: (error) => {
        throw error;
      },
    },
  );
  const document = new FakeSceneDocument();
  const object = shapeObject('visible', { x: 50 });
  document.create(object);
  runtime.setCamera({ x: 0, y: 0, zoom: 1, viewportWidthPx: 100, viewportHeightPx: 100, dpr: 1 });
  runtime.applyChangeSet(serializeChangeSet(document.takeChanges()));
  vi.spyOn(backend, 'submit').mockImplementationOnce(() => {
    document.update('visible', { x: 500 });
    runtime.applyChangeSet(serializeChangeSet(document.takeChanges()));
  });
  const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const stale = runtime.readProjection(bounds);
  platform.runFrame(16);
  await expect(stale).resolves.toBeUndefined();
  const current = runtime.readProjection(bounds);
  platform.runFrame(32);
  await expect(current).resolves.toMatchObject({ candidates: [] });
  runtime.destroy();
});
