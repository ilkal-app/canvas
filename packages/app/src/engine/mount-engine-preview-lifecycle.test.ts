// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type {
  EngineHost,
  PreviewCertificate,
  PreviewRequest,
  SceneProjection,
} from '@canvas/engine';

import { FakeHost, START_CAMERA, VIEWPORT } from './__fixtures__/fake-engine-host.js';
import { enqueueHostScene } from './host-scene-stream.js';
import { mountEnginePreview, type MountedEnginePreview } from './mount-engine-preview.js';
import { startBrowserHost } from './start-browser-host.js';

vi.mock('./start-browser-host.js', () => ({ startBrowserHost: vi.fn() }));
const previews: MountedEnginePreview[] = [];
const certificate: PreviewCertificate = {
  scene: { session: 'old', sequence: 0 },
  camera: START_CAMERA,
  coverage: { minX: 0, minY: 0, maxX: 400, maxY: 200 },
  fontSetKey: 'fonts',
  candidates: [],
  assets: [],
  imagePlanKey: '[]',
  lodPlanKey: '[]',
  frameIndex: 1,
  resourceGeneration: 1,
};

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
afterEach(async () => {
  for (const preview of previews.splice(0)) preview.destroy();
  await vi.runAllTimersAsync();
  vi.useRealTimers();
  vi.resetAllMocks();
});

function setup(start?: () => Promise<EngineHost>) {
  const host = Object.assign(new FakeHost(), {
    readProjection: vi.fn().mockResolvedValue({ camera: START_CAMERA }),
  });
  vi.mocked(startBrowserHost).mockResolvedValue(host as unknown as EngineHost);
  const canvas = document.createElement('canvas');
  const preview = mountEnginePreview(
    canvas,
    { objects: [], camera: START_CAMERA, viewport: VIEWPORT, isGridVisible: false },
    { prefer: 'worker', ...(start === undefined ? {} : { startHost: start }) },
  );
  previews.push(preview);
  return { host, canvas, preview };
}

it('starts the ordinary browser host with the retained canvas and grid preference', async () => {
  const { host, canvas, preview } = setup();
  await preview.ready;
  expect(startBrowserHost).toHaveBeenCalledExactlyOnceWith(
    canvas,
    'worker',
    { prefer: 'worker' },
    undefined,
  );
  expect(host.gridStates).toEqual([false]);
  expect(await preview.verifyResources(certificate)).toBe(false);
});

it('releases a host arriving after cancellation without sending any cached scene', async () => {
  let resolve: (host: EngineHost) => void = () => undefined;
  const { host, preview } = setup(
    () =>
      new Promise<EngineHost>((answer) => {
        resolve = answer;
      }),
  );
  preview.destroy();
  preview.resize({ ...VIEWPORT, widthPx: 800 });
  resolve(host as unknown as EngineHost);
  await preview.ready;
  await vi.runAllTimersAsync();
  expect(host.changeSets).toEqual([]);
  expect(host.isDestroyed).toBe(true);
  expect(await preview.verifyResources(certificate)).toBe(false);
});

it('propagates startup failure while a pending resize and teardown remain safe', async () => {
  const failure = new Error('device unavailable');
  const { preview } = setup(() => Promise.reject(failure));
  const rejected = expect(preview.ready).rejects.toBe(failure);
  preview.resize({ ...VIEWPORT, cssWidthPx: 800, widthPx: 800 });
  await rejected;
  preview.destroy();
  await vi.runAllTimersAsync();
});

it('keeps identical resize calls from invalidating preview coverage', async () => {
  const { host, preview } = setup();
  await preview.ready;
  const before = host.calls.length;
  preview.resize({ ...VIEWPORT });
  await Promise.resolve();
  expect(host.calls).toHaveLength(before);
  Object.assign(host, {
    readPreviewCertificate: vi
      .fn()
      .mockImplementation((request) => Promise.resolve({ ...certificate, ...request })),
  });
  expect(await preview.verifyResources(certificate)).toBe(true);
});

it('ignores a failed old frame after resize but never certifies the invalidated preview', async () => {
  const { host, preview } = setup();
  let resolve: (frame: SceneProjection | undefined) => void = () => undefined;
  host.readProjection.mockImplementationOnce(
    () =>
      new Promise<SceneProjection | undefined>((answer) => {
        resolve = answer;
      }),
  );
  await vi.waitFor(() => {
    expect(host.readProjection).toHaveBeenCalledTimes(1);
  });
  preview.resize({ ...VIEWPORT, cssWidthPx: 800, widthPx: 800 });
  host.readProjection.mockResolvedValue(undefined);
  resolve(undefined);
  await preview.ready;
  expect(await preview.verifyResources(certificate)).toBe(false);
});

it('rejects a resource certificate if the source scene changes while it is read', async () => {
  const { host, preview } = setup();
  await preview.ready;
  Object.assign(host, {
    readPreviewCertificate: vi.fn().mockImplementation((request) => {
      enqueueHostScene(host as unknown as EngineHost, {
        created: [],
        updated: [],
        deleted: [],
        objects: {},
      });
      return Promise.resolve({ ...certificate, ...request });
    }),
  });
  expect(await preview.verifyResources(certificate)).toBe(false);
});

it('waits for a later ordered frame when resources are not certified yet', async () => {
  const { host, preview } = setup();
  await preview.ready;
  const read = vi.fn((request: PreviewRequest) =>
    Promise.resolve({ ...certificate, ...request } as PreviewCertificate | undefined),
  );
  read.mockResolvedValueOnce(undefined);
  Object.assign(host, { readPreviewCertificate: read });
  expect(await preview.verifyResources(certificate)).toBe(true);
  expect(read).toHaveBeenCalledTimes(2);
});

it('stops unavailable-resource retries when its caller expires or changes the scene', async () => {
  const { host, preview } = setup();
  await preview.ready;
  let isCurrent = true;
  const read = vi.fn(() => {
    isCurrent = false;
    return Promise.resolve(undefined);
  });
  Object.assign(host, { readPreviewCertificate: read });
  expect(await preview.verifyResources(certificate, () => isCurrent)).toBe(false);
  expect(read).toHaveBeenCalledOnce();
  isCurrent = true;
  read.mockImplementation(() => {
    enqueueHostScene(host as unknown as EngineHost, {
      created: [],
      updated: [],
      deleted: [],
      objects: {},
    });
    return Promise.resolve(undefined);
  });
  expect(await preview.verifyResources(certificate, () => isCurrent)).toBe(false);
  expect(read).toHaveBeenCalledTimes(2);
});

it('bounds retries when a host never supplies resource evidence', async () => {
  const { host, preview } = setup();
  await preview.ready;
  const read = vi.fn(() => Promise.resolve(undefined));
  Object.assign(host, { readPreviewCertificate: read });
  expect(await preview.verifyResources(certificate)).toBe(false);
  expect(read.mock.calls.length).toBeGreaterThan(1);
  expect(read.mock.calls.length).toBeLessThanOrEqual(32);
});
