import { describe, expect, it } from 'vitest';

import { INK_COLORS, type Rgba } from '@canvas/schema';

import type { Camera } from '../camera/camera.js';
import {
  FakeSceneDocument,
  frameObject,
  shapeObject,
} from '../scene/__fixtures__/scene-objects.js';
import { FRAME_FILL_LUMINANCE } from '../scene/color-mode-fallback.js';

import {
  FakeCanvas,
  FakeHostPlatform,
  ReadableFakeGpuBackend,
} from './__fixtures__/fake-host-platform.js';
import { InMemoryEngineWorker, settle } from './__fixtures__/in-memory-engine-worker.js';
import { deserializeColorTokens, serializeColorTokens } from './color-token-messages.js';
import type { EngineHostOptions } from './engine-host.js';
import { EngineRuntime } from './engine-runtime.js';
import { isHostToWorkerMessage } from './host-protocol.js';
import { MainThreadEngineHost } from './main-thread-engine-host.js';
import { serializeChangeSet } from './serializable-change-set.js';
import { WorkerEngineHost } from './worker-engine-host.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 4, viewportHeightPx: 2, dpr: 1 };
const CUSTOM = { light: [0.1, 0.1, 0.1, 1] as Rgba, dark: [0.9, 0.9, 0.9, 1] as Rgba };

function inkBoard(): ReturnType<typeof serializeChangeSet> {
  const document = new FakeSceneDocument();
  document.create(shapeObject('a', { stroke: { color: 'ink', width: 2 } }));
  return serializeChangeSet(document.takeChanges());
}

function setUp(options: EngineHostOptions = {}) {
  const platform = new FakeHostPlatform();
  const canvas = new FakeCanvas(4, 2);
  const first = new ReadableFakeGpuBackend(canvas);
  const second = new ReadableFakeGpuBackend(canvas);
  const runtime = new EngineRuntime(
    first,
    canvas,
    platform,
    options,
    { onFrame: () => undefined, onFault: () => undefined },
    { recreateBackend: () => Promise.resolve({ backend: second }) },
  );
  runtime.applyChangeSet(inkBoard());
  runtime.setCamera(CAMERA);
  platform.runFrame(16);
  return { platform, runtime, first, second };
}

describe('EngineRuntime.setTheme', () => {
  it('starts in the host’s theme and ink colours', () => {
    expect(setUp().runtime.renderer.scene.ink).toBe(INK_COLORS.light);
    const { runtime } = setUp({ theme: 'dark', inkColors: CUSTOM });
    expect(runtime.renderer.scene.ink).toBe(CUSTOM.dark);
  });

  it('switches the ink and asks for a frame, which uploads only the ink record', () => {
    const { platform, runtime, first } = setUp();
    expect(platform.pendingFrames).toBe(0);
    runtime.view.setTheme('dark');
    expect(runtime.renderer.scene.ink).toBe(INK_COLORS.dark);
    expect(platform.pendingFrames).toBe(1);
    first.resetCalls();
    platform.runFrame(32);
    expect(first.writes().map(({ label }) => label)).toEqual(['sdf-shape instances']);
    runtime.view.setTheme('light', CUSTOM);
    expect(runtime.renderer.scene.ink).toBe(CUSTOM.light);
  });

  it('keeps the theme across a lost device', async () => {
    const { platform, runtime, first } = setUp();
    runtime.view.setTheme('dark', CUSTOM);
    platform.runFrame(32);
    first.loseDevice();
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
    expect(runtime.renderer.scene.ink).toBe(CUSTOM.dark);
  });

  it('does nothing once destroyed', () => {
    const { platform, runtime } = setUp();
    runtime.destroy();
    runtime.view.setTheme('dark');
    expect(platform.pendingFrames).toBe(0);
  });
});

describe('the theme command', () => {
  const commands = (command: unknown) => ({ type: 'engine-commands', commands: [command] });

  it('crosses to the worker with its theme and ink colours', () => {
    expect(isHostToWorkerMessage(commands({ type: 'theme', theme: 'dark' }))).toBe(true);
    expect(
      isHostToWorkerMessage(commands({ type: 'theme', theme: 'light', inkColors: CUSTOM })),
    ).toBe(true);
    for (const bad of [
      { type: 'theme', theme: 'sepia' },
      { type: 'theme' },
      { type: 'theme', theme: 'dark', inkColors: { light: [0, 0, 0, 1] } },
      { type: 'theme', theme: 'dark', inkColors: { light: [0, 0, 0], dark: [0, 0, 0, 1] } },
      { type: 'theme', theme: 'dark', inkColors: 'ink' },
    ]) {
      expect(isHostToWorkerMessage(commands(bad)), JSON.stringify(bad)).toBe(false);
    }
  });

  it('is what the worker host sends and the worker applies', async () => {
    const worker = new InMemoryEngineWorker(0);
    const created = WorkerEngineHost.create(worker, new FakeCanvas(4, 2), 0, { theme: 'light' });
    await settle();
    const host = await created;
    const reports: unknown[] = [];
    host.onFrame((report) => reports.push(report));
    host.setCamera(CAMERA);
    host.setTheme('dark', CUSTOM);
    await worker.runFrame(16);
    expect(worker.received.at(-1)).toEqual({
      type: 'engine-commands',
      commands: [
        { type: 'camera', camera: CAMERA },
        { type: 'theme', theme: 'dark', inkColors: CUSTOM },
      ],
    });
    expect(reports).toHaveLength(1);
  });
});

describe('MainThreadEngineHost.setTheme', () => {
  it('switches the theme on the page and asks for a frame', async () => {
    const platform = new FakeHostPlatform();
    const host = await MainThreadEngineHost.create(new FakeCanvas(), platform);
    host.setCamera(CAMERA);
    platform.runFrame(0);
    host.setTheme('dark');
    expect(platform.pendingFrames).toBe(1);
    host.destroy();
  });
});

describe('colour tokens through the hosts', () => {
  const brandTable = new Map([
    ['brand', { light: [1, 0, 0, 1] as Rgba, dark: [0, 0, 1, 1] as Rgba }],
  ]);
  const commands = (command: unknown) => ({ type: 'engine-commands', commands: [command] });

  function tokenBoard(): ReturnType<typeof serializeChangeSet> {
    const document = new FakeSceneDocument();
    document.create(shapeObject('a', { stroke: { color: { token: 'brand' } as never, width: 2 } }));
    return serializeChangeSet(document.takeChanges());
  }

  function outlineOf(runtime: EngineRuntime): number[] {
    const { scene } = runtime.renderer;
    const [slot] = scene.slotsOf('a' as never, 'sdf-shape');
    const floats = scene.instanceBufferOf('sdf-shape').layout.floatsPerRecord;
    const at = (slot ?? 0) * floats + 13;
    return Array.from(scene.instanceBufferOf('sdf-shape').data.subarray(at, at + 4));
  }

  it('crosses to the worker as plain entries, and the worker checks them', () => {
    const tokens = serializeColorTokens(brandTable);
    expect(tokens).toEqual([{ id: 'brand', light: [1, 0, 0, 1], dark: [0, 0, 1, 1] }]);
    expect(deserializeColorTokens(tokens)).toEqual(brandTable);
    expect(isHostToWorkerMessage(commands({ type: 'tokens', tokens }))).toBe(true);
    expect(isHostToWorkerMessage(commands({ type: 'tokens', tokens: [] }))).toBe(true);
    for (const bad of [
      { type: 'tokens' },
      { type: 'tokens', tokens: {} },
      { type: 'tokens', tokens: [{ id: 3, light: [0, 0, 0, 1], dark: [0, 0, 0, 1] }] },
      { type: 'tokens', tokens: [{ id: 'x', light: [0, 0, 0], dark: [0, 0, 0, 1] }] },
    ]) {
      expect(isHostToWorkerMessage(commands(bad)), JSON.stringify(bad)).toBe(false);
    }
  });

  it('is what the worker host sends, and the worker redraws only the token record', async () => {
    const worker = new InMemoryEngineWorker(0);
    const created = WorkerEngineHost.create(worker, new FakeCanvas(4, 2), 0);
    await settle();
    const host = await created;
    host.applyChangeSet(tokenBoard());
    host.setCamera(CAMERA);
    await worker.runFrame(16);
    host.setColorTokens(brandTable);
    await settle();
    expect(worker.received.at(-1)).toEqual({
      type: 'engine-commands',
      commands: [{ type: 'tokens', tokens: serializeColorTokens(brandTable) }],
    });
    const [backend] = worker.platform.backends;
    backend?.resetCalls();
    await worker.runFrame(32);
    expect(backend?.writes().map(({ label }) => label)).toEqual(['sdf-shape instances']);
  });

  it('draws as the main-thread runtime draws, and keeps the table across a lost device', async () => {
    const { platform, runtime, first } = setUp();
    runtime.applyChangeSet(tokenBoard());
    runtime.view.setColorTokens(deserializeColorTokens(serializeColorTokens(brandTable)));
    platform.runFrame(32);
    expect(outlineOf(runtime)).toEqual([1, 0, 0, 1]);
    first.loseDevice();
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
    platform.runFrame(48);
    expect(outlineOf(runtime)).toEqual([1, 0, 0, 1]);
    runtime.view.setTheme('dark');
    expect(outlineOf(runtime)).toEqual([0, 0, 1, 1]);
  });

  it('switches the table on the page through the main-thread host', async () => {
    const platform = new FakeHostPlatform();
    const host = await MainThreadEngineHost.create(new FakeCanvas(), platform);
    host.setCamera(CAMERA);
    platform.runFrame(0);
    host.setColorTokens(brandTable);
    expect(platform.pendingFrames).toBe(1);
    host.destroy();
  });
});

describe('the frame-fill fallback through the hosts', () => {
  function framedInk(): ReturnType<typeof serializeChangeSet> {
    const document = new FakeSceneDocument();
    document.create(
      frameObject('night', { background: [0, 0, 0, 1] }),
      shapeObject('a', { parentId: 'night', stroke: { color: 'ink', width: 2 } }),
    );
    return serializeChangeSet(document.takeChanges());
  }

  function outlineOf(runtime: EngineRuntime): number[] {
    const { scene } = runtime.renderer;
    const [slot] = scene.slotsOf('a' as never, 'sdf-shape');
    const floats = scene.instanceBufferOf('sdf-shape').layout.floatsPerRecord;
    const at = (slot ?? 0) * floats + 13;
    return Array.from(scene.instanceBufferOf('sdf-shape').data.subarray(at, at + 4));
  }

  const lightInk = Array.from(new Float32Array(INK_COLORS.dark));
  const darkInk = Array.from(new Float32Array(INK_COLORS.light));

  it('draws ink on a dark frame light when the host names the rule, across a lost device', async () => {
    const { platform, runtime, first } = setUp({ colorModeFallback: FRAME_FILL_LUMINANCE });
    runtime.applyChangeSet(framedInk());
    platform.runFrame(32);
    expect(outlineOf(runtime)).toEqual(lightInk);
    first.loseDevice();
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
    platform.runFrame(48);
    expect(outlineOf(runtime)).toEqual(lightInk);
  });

  it('follows the viewer without it, or with a name it does not know', () => {
    for (const options of [{}, { colorModeFallback: 'frame-fill' as never }]) {
      const { platform, runtime } = setUp(options);
      runtime.applyChangeSet(framedInk());
      platform.runFrame(32);
      expect(outlineOf(runtime)).toEqual(darkInk);
    }
  });

  it('crosses to the worker by name in the host options', async () => {
    const worker = new InMemoryEngineWorker(0);
    const created = WorkerEngineHost.create(worker, new FakeCanvas(4, 2), 0, {
      colorModeFallback: FRAME_FILL_LUMINANCE,
    });
    await settle();
    await created;
    expect(worker.received[0]).toMatchObject({
      type: 'engine-init',
      options: { colorModeFallback: 'frame-fill-luminance' },
    });
  });
});
