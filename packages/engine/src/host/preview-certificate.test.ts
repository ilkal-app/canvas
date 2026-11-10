import { expect, it, vi } from 'vitest';

import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { SceneRenderer } from '../scene/scene-renderer.js';

import { FakeCanvas } from './__fixtures__/fake-host-platform.js';
import { InMemoryEngineWorker, settle } from './__fixtures__/in-memory-engine-worker.js';
import { isHostToWorkerMessage, isWorkerToHostMessage } from './host-protocol.js';
import { PreviewReads } from './preview-reads.js';
import { serializeChangeSet } from './serializable-change-set.js';
import { WorkerEngineHost } from './worker-engine-host.js';

const CAMERA = { x: 0, y: 0, zoom: 1, viewportWidthPx: 100, viewportHeightPx: 100, dpr: 1 };
const REQUEST = {
  scene: { session: 'mount', sequence: 0 },
  camera: CAMERA,
  coverage: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  fontSetKey: 'font-content',
};

it('checks exact applied scene, camera and pending arrivals without claiming resource readiness', async () => {
  const reads = new PreviewReads();
  expect(reads.matchesFrame(REQUEST, CAMERA, false)).toBe(false);
  reads.revisions.apply(REQUEST.scene);
  expect(reads.matchesFrame(REQUEST, CAMERA, false)).toBe(true);
  expect(reads.matchesFrame(REQUEST, CAMERA, true)).toBe(false);
  for (const key of Object.keys(CAMERA) as (keyof typeof CAMERA)[]) {
    expect(reads.matchesFrame(REQUEST, { ...CAMERA, [key]: CAMERA[key] + 1 }, false)).toBe(false);
  }
  const renderer = new SceneRenderer(new FakeGpuBackend());
  const owned = {
    ...REQUEST,
    scene: { ...REQUEST.scene },
    camera: { ...CAMERA },
    coverage: { ...REQUEST.coverage },
  };
  const pending = reads.read(owned);
  owned.coverage.maxX = -1;
  const query = vi.spyOn(renderer, 'projectionCandidates');
  reads.answer(renderer, CAMERA, false);
  expect(query).toHaveBeenCalledWith(REQUEST.coverage);
  await expect(pending).resolves.toBeUndefined();
  renderer.destroy();
});

it('accepts only valid requests and rejects incomplete certificate replies', () => {
  const command = { type: 'read-preview-certificate', id: 1, request: REQUEST };
  expect(isHostToWorkerMessage({ type: 'engine-commands', commands: [command] })).toBe(true);
  expect(
    isHostToWorkerMessage({
      type: 'engine-commands',
      commands: [
        { ...command, request: { ...REQUEST, scene: { session: 'mount', sequence: -1 } } },
      ],
    }),
  ).toBe(false);
  expect(
    isWorkerToHostMessage({ type: 'engine-preview-certificate', id: 1, certificate: undefined }),
  ).toBe(true);
  expect(
    isWorkerToHostMessage({
      type: 'engine-preview-certificate',
      id: 1,
      certificate: { ...REQUEST, candidates: [] },
    }),
  ).toBe(false);
});

it('copies worker stamps/requests and waits for an applied frame before returning no certificate', async () => {
  const worker = new InMemoryEngineWorker(0);
  const starting = WorkerEngineHost.create(worker, new FakeCanvas(100, 100), 0, {});
  await settle();
  const host = await starting;
  const document = new FakeSceneDocument();
  document.create(shapeObject('visible'));
  const stamp = { ...REQUEST.scene };
  host.applyChangeSet(serializeChangeSet(document.takeChanges()), stamp);
  stamp.sequence = 99;
  host.setCamera(CAMERA);
  const request = { ...REQUEST, camera: { ...CAMERA } };
  const pending = host.readPreviewCertificate(request);
  request.camera.x = 200;
  let hasSettled = false;
  void pending.then(() => {
    hasSettled = true;
  });
  await settle();
  expect(hasSettled).toBe(false);
  expect(worker.received.at(-1)).toMatchObject({
    commands: [
      { type: 'change-set', stamp: REQUEST.scene },
      { type: 'camera' },
      { type: 'read-preview-certificate', request: REQUEST },
    ],
  });
  await worker.runFrame(16);
  await expect(pending).resolves.toBeUndefined();
  const late = host.readPreviewCertificate(REQUEST);
  const rejected = expect(late).rejects.toThrow('destroyed');
  host.destroy();
  await rejected;
  await expect(host.readPreviewCertificate(REQUEST)).rejects.toThrow('destroyed');
});

it('never turns an unsupported renderer or pending renderer changes into a certificate', async () => {
  const reads = new PreviewReads();
  reads.revisions.apply(REQUEST.scene);
  const renderer = new SceneRenderer(new FakeGpuBackend());
  const query = vi.spyOn(renderer, 'projectionCandidates').mockReturnValue(undefined);
  const unsupported = reads.read(REQUEST);
  reads.answer(renderer, CAMERA, false);
  await expect(unsupported).resolves.toBeUndefined();
  query.mockRestore();
  const document = new FakeSceneDocument();
  document.create(shapeObject('pending'));
  renderer.enqueue(document.takeChanges());
  const pending = reads.read(REQUEST);
  reads.answer(renderer, CAMERA, false);
  await expect(pending).resolves.toBeUndefined();
  renderer.destroy();
});

it('certifies a completed supported frame and validates its complete protocol reply', async () => {
  const reads = new PreviewReads();
  reads.revisions.apply(REQUEST.scene);
  const renderer = new SceneRenderer(new FakeGpuBackend());
  renderer.renderFrame({ timeMs: 0, camera: CAMERA });
  const pending = reads.read(REQUEST);
  reads.answer(renderer, CAMERA, false);
  const certificate = await pending;
  expect(certificate).toMatchObject({
    ...REQUEST,
    candidates: [],
    assets: [],
    imagePlanKey: '[]',
    frameIndex: 0,
  });
  expect(isWorkerToHostMessage({ type: 'engine-preview-certificate', id: 1, certificate })).toBe(
    true,
  );
  for (const malformed of [
    { ...certificate, frameIndex: -1 },
    { ...certificate, imagePlanKey: undefined },
    { ...certificate, assets: [{}] },
  ]) {
    expect(
      isWorkerToHostMessage({ type: 'engine-preview-certificate', id: 1, certificate: malformed }),
    ).toBe(false);
  }
  renderer.destroy();
});

it('rechecks a live runtime fence after resource callbacks', async () => {
  const reads = new PreviewReads();
  reads.revisions.apply(REQUEST.scene);
  const renderer = new SceneRenderer(new FakeGpuBackend());
  renderer.renderFrame({ timeMs: 0, camera: CAMERA });
  let hasPending = false;
  const original = renderer.readPreviewResources.bind(renderer);
  const resourceRead = vi.spyOn(renderer, 'readPreviewResources').mockImplementation((...args) => {
    const result = original(...args);
    hasPending = true;
    return result;
  });
  const pending = reads.read(REQUEST);
  reads.answer(renderer, CAMERA, () => hasPending);
  await expect(pending).resolves.toBeUndefined();
  expect(resourceRead).toHaveBeenCalled();
  renderer.destroy();
});

it('refuses coverage that omits any part of the drawn viewport', () => {
  const reads = new PreviewReads();
  reads.revisions.apply(REQUEST.scene);
  for (const coverage of [
    { ...REQUEST.coverage, minX: 1 },
    { ...REQUEST.coverage, minY: 1 },
    { ...REQUEST.coverage, maxX: 99 },
    { ...REQUEST.coverage, maxY: 99 },
  ])
    expect(reads.matchesFrame({ ...REQUEST, coverage }, CAMERA, false)).toBe(false);
});

it('rejects failed contributor reads and permits a later successful query', async () => {
  const reads = new PreviewReads();
  reads.revisions.apply(REQUEST.scene);
  const renderer = new SceneRenderer(new FakeGpuBackend());
  renderer.renderFrame({ timeMs: 0, camera: CAMERA });
  const query = vi.spyOn(renderer, 'projectionCandidates').mockImplementationOnce(() => {
    throw new Error('candidate query failed');
  });
  const failed = reads.read(REQUEST);
  reads.answer(renderer, CAMERA, false);
  await expect(failed).rejects.toThrow('candidate query failed');
  query.mockRestore();
  const next = reads.read(REQUEST);
  reads.answer(renderer, CAMERA, false);
  await expect(next).resolves.toMatchObject({ scene: REQUEST.scene, frameIndex: 0 });
  renderer.destroy();
});
