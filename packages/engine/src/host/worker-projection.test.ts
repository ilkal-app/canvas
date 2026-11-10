import { expect, it } from 'vitest';

import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';

import { FakeCanvas } from './__fixtures__/fake-host-platform.js';
import { InMemoryEngineWorker, settle } from './__fixtures__/in-memory-engine-worker.js';
import { serializeChangeSet } from './serializable-change-set.js';
import { WorkerEngineHost } from './worker-engine-host.js';

const CAMERA = { x: 0, y: 0, zoom: 1, viewportWidthPx: 100, viewportHeightPx: 100, dpr: 1 };
const BOUNDS = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

async function fixture() {
  const worker = new InMemoryEngineWorker(0);
  const creating = WorkerEngineHost.create(worker, new FakeCanvas(100, 100), 0, {});
  await settle();
  const host = await creating;
  return { worker, host };
}

it('answers only after queued document changes reach the real worker frame', async () => {
  const { host, worker } = await fixture();
  const document = new FakeSceneDocument();
  const object = shapeObject('visible', { x: 50 });
  document.create(object);
  host.setCamera(CAMERA);
  host.applyChangeSet(serializeChangeSet(document.takeChanges()));
  const bounds = { ...BOUNDS };
  const pending = host.readProjection(bounds);
  bounds.maxX = -1;
  let hasSettled = false;
  void pending.then(() => {
    hasSettled = true;
  });
  await settle();
  expect(hasSettled).toBe(false);
  await worker.runFrame(16);
  await expect(pending).resolves.toEqual({
    candidates: [object.id],
    camera: CAMERA,
    hasPendingWork: false,
  });
  document.update('visible', { x: 500 });
  host.applyChangeSet(serializeChangeSet(document.takeChanges()));
  const moved = host.readProjection(BOUNDS);
  await worker.runFrame(32);
  await expect(moved).resolves.toMatchObject({ candidates: [] });
  host.destroy();
});

it('rejects pending and future projection reads after destruction', async () => {
  const { host } = await fixture();
  const pending = host.readProjection(BOUNDS);
  const rejected = expect(pending).rejects.toThrow('destroyed');
  host.destroy();
  await rejected;
  await expect(host.readProjection(BOUNDS)).rejects.toThrow('destroyed');
});

it('returns a correlated failure for nonfinite coverage without losing later reads', async () => {
  const { host, worker } = await fixture();
  const invalid = host.readProjection({ ...BOUNDS, maxX: Number.NaN });
  const rejected = expect(invalid).rejects.toThrow('finite');
  await settle();
  await rejected;
  host.setCamera(CAMERA);
  const next = host.readProjection(BOUNDS);
  await worker.runFrame(16);
  await expect(next).resolves.toMatchObject({ candidates: [] });
  host.destroy();
});
