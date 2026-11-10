// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { EngineHost, SceneProjection, PreviewRequest } from '@canvas/engine';
import type { ObjectId } from '@canvas/schema';

import { FakeHost, START_CAMERA, VIEWPORT } from './__fixtures__/fake-engine-host.js';
import { createDemoDocument } from './demo-document.js';
import { mountEnginePreview, type MountedEnginePreview } from './mount-engine-preview.js';

const previews: MountedEnginePreview[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
});
afterEach(async () => {
  for (const preview of previews.splice(0)) preview.destroy();
  await vi.runAllTimersAsync();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function setup() {
  const host = new FakeHost();
  const pending: ((value: SceneProjection | undefined) => void)[] = [];
  const readProjection = vi.fn(
    () =>
      new Promise<SceneProjection | undefined>((resolve) => {
        pending.push(resolve);
      }),
  );
  const engineHost = Object.assign(host, { readProjection }) as unknown as EngineHost;
  const startHost = vi.fn(() => Promise.resolve(engineHost));
  const canvas = document.createElement('canvas');
  Object.assign(canvas, { setPointerCapture: () => undefined });
  document.body.append(canvas);
  const store = createDemoDocument();
  const objects = [...store.read().objects.values()];
  const first = objects[0];
  if (first === undefined) throw new Error('fixture is empty');
  const cachedOnly = { ...first, id: 'cached-only' as ObjectId, parentId: null };
  const preview = mountEnginePreview(
    canvas,
    {
      objects: [...objects, cachedOnly],
      camera: START_CAMERA,
      viewport: VIEWPORT,
      isGridVisible: false,
    },
    { prefer: 'worker', startHost },
  );
  previews.push(preview);
  const confirm = async (camera = START_CAMERA) => {
    await vi.waitFor(() => {
      expect(pending.length).toBeGreaterThan(0);
    });
    pending.shift()?.({ camera, candidates: [], hasPendingWork: false });
  };
  const pointer = () =>
    canvas.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 1,
        button: 0,
        clientX: 60,
        clientY: 60,
      }),
    );
  return { host, pending, preview, store, confirm, pointer, startHost, readProjection };
}

it('keeps preview inert and opens input only after the same host acknowledges live replacement', async () => {
  const { host, preview, store, confirm, pointer, startHost, pending } = setup();
  pointer();
  expect(host.inputs).toEqual([]);
  await confirm();
  await preview.ready;
  let didResolve = false;
  const live = preview.attachLive({ store }).then((engine) => {
    didResolve = true;
    return engine;
  });
  await vi.waitFor(() => {
    expect(pending).toHaveLength(1);
  });
  expect(host.changeSets.at(-1)?.deleted).toEqual(['cached-only']);
  expect(host.changeSets.at(-1)?.updated.length).toBe(store.read().objects.size);
  pointer();
  host.emitFrame(START_CAMERA);
  await Promise.resolve();
  expect(didResolve).toBe(false);
  expect(host.inputs).toEqual([]);
  await confirm();
  const engine = await live;
  expect(startHost).toHaveBeenCalledTimes(1);
  pointer();
  expect(engine.inspect().selectedIds.length).toBeGreaterThan(0);
  expect(host.inputs).toHaveLength(1);
  await expect(preview.attachLive({ store })).rejects.toThrow('another document');
  preview.destroy();
  store.destroy();
});

it('cancels a pending handoff without exposing input or destroying a host twice', async () => {
  const { host, preview, store, confirm, pending, pointer } = setup();
  await confirm();
  const live = preview.attachLive({ store });
  const failed = expect(live).rejects.toThrow('unmounted');
  await vi.waitFor(() => {
    expect(pending).toHaveLength(1);
  });
  preview.destroy();
  preview.destroy();
  await failed;
  pointer();
  expect(host.inputs).toEqual([]);
  await confirm();
  await vi.runAllTimersAsync();
  expect(host.isDestroyed).toBe(true);
  store.destroy();
});

it('clears cached coverage on resize and hands off with the updated camera and viewport', async () => {
  const { host, preview, store, confirm, pending } = setup();
  await confirm();
  await preview.ready;
  const resized = { ...VIEWPORT, widthPx: 600, cssWidthPx: 600 };
  const camera = { ...START_CAMERA, viewportWidthPx: 600 };
  preview.resize(resized);
  await Promise.resolve();
  expect(host.changeSets.at(-1)?.deleted).toContain('cached-only');
  const live = preview.attachLive({ store });
  await vi.waitFor(() => {
    expect(pending).toHaveLength(1);
  });
  expect(host.changeSets.at(-1)?.created.length).toBe(store.read().objects.size);
  await confirm(camera);
  expect((await live).camera()).toEqual(camera);
  preview.destroy();
  store.destroy();
});

it('fails closed when the host cannot acknowledge its replacement scene', async () => {
  const { host, preview, store, confirm, pending, pointer, readProjection } = setup();
  await confirm();
  const live = preview.attachLive({ store });
  const failed = expect(live).rejects.toThrow('could not be confirmed');
  await vi.waitFor(() => {
    expect(pending).toHaveLength(1);
  });
  readProjection.mockResolvedValue(undefined);
  pending.shift()?.(undefined);
  await failed;
  expect(readProjection).toHaveBeenCalledTimes(33);
  pointer();
  expect(host.inputs).toEqual([]);
  store.destroy();
});

it('waits for the resized live frame when the viewport changes during handoff', async () => {
  const { preview, store, confirm, pending } = setup();
  await confirm();
  let isReady = false;
  const live = preview.attachLive({ store }).then((engine) => {
    isReady = true;
    return engine;
  });
  await vi.waitFor(() => {
    expect(pending).toHaveLength(1);
  });
  preview.resize({ ...VIEWPORT, widthPx: 600, cssWidthPx: 600 });
  await confirm();
  await vi.waitFor(() => {
    expect(pending).toHaveLength(1);
  });
  expect(isReady).toBe(false);
  const camera = { ...START_CAMERA, viewportWidthPx: 600 };
  await confirm(camera);
  expect((await live).camera()).toEqual(camera);
  preview.destroy();
  store.destroy();
});

it('cancels before the first frame without constructing a live document', async () => {
  const { preview, store, confirm, host, pointer } = setup();
  const subscribe = vi.spyOn(store, 'subscribe');
  const live = preview.attachLive({ store });
  const failed = expect(live).rejects.toThrow('unmounted');
  await vi.waitFor(() => {
    expect(host.changeSets.length).toBeGreaterThan(0);
  });
  preview.destroy();
  await preview.ready;
  await failed;
  expect(subscribe).not.toHaveBeenCalled();
  await confirm();
  pointer();
  expect(host.inputs).toEqual([]);
  store.destroy();
});

it('leaves editing disabled after handoff until the caller applies the authenticated role', async () => {
  const { preview, store, confirm, pending } = setup();
  await confirm();
  const attaching = preview.attachLive({ store });
  await vi.waitFor(() => {
    expect(pending).toHaveLength(1);
  });
  await confirm();
  const engine = await attaching;
  const count = store.read().objects.size;
  engine.runCanvasAction({ type: 'selection', command: 'selectAll' });
  engine.runCanvasAction({ type: 'selection', command: 'delete' });
  expect(store.read().objects.size).toBe(count);
  engine.setEditable(true);
  engine.runCanvasAction({ type: 'selection', command: 'delete' });
  expect(store.read().objects.size).toBeLessThan(count);
  preview.destroy();
  store.destroy();
});

it('requires fresh matching resources and rejects a verification invalidated by resize', async () => {
  const { host, preview, store, confirm } = setup();
  await confirm();
  await preview.ready;
  const historical = {
    scene: { session: 'old', sequence: 0 },
    camera: START_CAMERA,
    coverage: { minX: 0, minY: 0, maxX: 10000, maxY: 10000 },
    fontSetKey: 'font-content',
    candidates: [],
    assets: [],
    imagePlanKey: '[]',
    lodPlanKey: '[]',
    frameIndex: 1,
    resourceGeneration: 1,
  };
  Object.assign(host, {
    readPreviewCertificate: vi.fn((request: PreviewRequest) =>
      Promise.resolve({ ...historical, ...request }),
    ),
  });
  expect(await preview.verifyResources(historical)).toBe(true);
  Object.assign(host, {
    readPreviewCertificate: vi.fn((request: PreviewRequest) =>
      Promise.resolve({
        ...historical,
        ...request,
        fontSetKey: 'other',
      }),
    ),
  });
  expect(await preview.verifyResources(historical)).toBe(false);
  let answer: ((value: typeof historical) => void) | undefined;
  Object.assign(host, {
    readPreviewCertificate: vi.fn(
      () =>
        new Promise<typeof historical>((resolve) => {
          answer = resolve;
        }),
    ),
  });
  const verifying = preview.verifyResources(historical);
  await vi.waitFor(() => {
    expect(answer).toBeDefined();
  });
  preview.resize({ ...VIEWPORT, cssWidthPx: 600, widthPx: 600 });
  answer?.(historical);
  expect(await verifying).toBe(false);
  store.destroy();
});

it('replaces a failed optional preview on the same host before exposing live input', async () => {
  const { host, preview, store, confirm, pending, pointer, startHost, readProjection } = setup();
  readProjection.mockRejectedValueOnce(new Error('preview frame failed'));
  await expect(preview.ready).rejects.toThrow('preview frame failed');
  let didOpen = false;
  const live = preview.attachLive({ store }).then((engine) => {
    didOpen = true;
    return engine;
  });
  // Observe rejection immediately so the baseline failure stays within this test.
  void live.catch(() => undefined);
  await vi.waitFor(() => {
    expect(pending).toHaveLength(1);
  });
  expect(host.changeSets.at(-1)?.deleted).toContain('cached-only');
  pointer();
  expect(host.inputs).toEqual([]);
  host.emitFrame(START_CAMERA);
  await Promise.resolve();
  expect(didOpen).toBe(false);
  await confirm();
  const engine = await live;
  expect(startHost).toHaveBeenCalledTimes(1);
  pointer();
  engine.inspect();
  expect(host.inputs).toHaveLength(1);
  preview.destroy();
  store.destroy();
});
