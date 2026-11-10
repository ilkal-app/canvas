import { describe, expect, it, vi } from 'vitest';

import type { Camera } from '../camera/camera.js';
import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';

import {
  FakeCanvas,
  FakeHostPlatform,
  ReadableFakeGpuBackend,
} from './__fixtures__/fake-host-platform.js';
import { EngineRuntime } from './engine-runtime.js';
import { serializeChangeSet } from './serializable-change-set.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 4, viewportHeightPx: 2, dpr: 1 };

async function settleRecovery(): Promise<void> {
  for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();
}

function backend(canvas: FakeCanvas, name: 'webgpu' | 'webgl2'): ReadableFakeGpuBackend {
  const result = new ReadableFakeGpuBackend(canvas);
  Object.assign(result.capabilities, { backendName: name });
  return result;
}

describe('EngineRuntime backend switch after device loss', () => {
  it('passes the lost WebGPU name, adopts WebGL2, replays the scene, and resizes its new canvas', async () => {
    const platform = new FakeHostPlatform();
    const original = new FakeCanvas(4, 2);
    const fallback = new FakeCanvas(4, 2);
    const first = backend(original, 'webgpu');
    const second = backend(fallback, 'webgl2');
    const recreateBackend = vi.fn((...args: unknown[]) => {
      expect(args.length).toBeGreaterThan(0);
      return Promise.resolve({ backend: second, canvas: fallback });
    });
    const faults: Error[] = [];
    const runtime = new EngineRuntime(
      first,
      original,
      platform,
      {},
      { onFrame: () => undefined, onFault: (error) => faults.push(error) },
      {
        recreateBackend,
      },
    );
    const document = new FakeSceneDocument();
    document.create(shapeObject('rect'));
    runtime.applyChangeSet(serializeChangeSet(document.takeChanges()));
    runtime.setCamera(CAMERA);
    platform.runFrame(16);

    first.loseDevice();
    await settleRecovery();
    platform.runFrame(32);

    expect(recreateBackend).toHaveBeenCalledOnce();
    expect(recreateBackend.mock.calls[0]?.[1]).toBe('webgpu');
    expect(second.writes().map(({ label }) => label)).toContain('sdf-shape instances');
    expect(second.draws()).toHaveLength(1);
    expect(faults).toEqual([]);

    runtime.resize(8, 6, 1);
    expect([fallback.width, fallback.height]).toEqual([8, 6]);
    expect([original.width, original.height]).toEqual([4, 2]);
  });

  it('passes the lost WebGL2 name and continues on the original canvas', async () => {
    const platform = new FakeHostPlatform();
    const canvas = new FakeCanvas(4, 2);
    const first = backend(canvas, 'webgl2');
    const second = backend(canvas, 'webgl2');
    const recreateBackend = vi.fn((...args: unknown[]) => {
      expect(args.length).toBeGreaterThan(0);
      return Promise.resolve({ backend: second });
    });
    const runtime = new EngineRuntime(
      first,
      canvas,
      platform,
      {},
      { onFrame: () => undefined, onFault: () => undefined },
      {
        recreateBackend,
      },
    );
    const document = new FakeSceneDocument();
    document.create(shapeObject('rect'));
    runtime.applyChangeSet(serializeChangeSet(document.takeChanges()));
    runtime.setCamera(CAMERA);
    platform.runFrame(16);
    first.loseDevice();
    await settleRecovery();
    platform.runFrame(32);

    expect(recreateBackend.mock.calls[0]?.[1]).toBe('webgl2');
    expect(second.draws()).toHaveLength(1);
    runtime.resize(7, 5, 1);
    expect([canvas.width, canvas.height]).toEqual([7, 5]);
  });

  it('reports a rejected replacement backend through onFault', async () => {
    const platform = new FakeHostPlatform();
    const canvas = new FakeCanvas();
    const first = backend(canvas, 'webgpu');
    const faults: Error[] = [];
    const recreateBackend = vi.fn((...args: unknown[]) => {
      expect(args.length).toBeGreaterThan(0);
      return Promise.reject(new Error('WebGL2 unavailable'));
    });
    const runtime = new EngineRuntime(
      first,
      canvas,
      platform,
      {},
      { onFrame: () => undefined, onFault: (error) => faults.push(error) },
      { recreateBackend },
    );
    runtime.setCamera(CAMERA);
    platform.runFrame(16);
    first.loseDevice();
    await settleRecovery();

    expect(recreateBackend.mock.calls[0]?.[1]).toBe('webgpu');
    expect(faults.map(({ message }) => message)).toEqual(['WebGL2 unavailable']);
  });
});
