import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CreateGpuBackendOptions } from '../gpu/create-gpu-backend.js';

import { FakeCanvas, FakeHostPlatform } from './__fixtures__/fake-host-platform.js';
import { createEngineHost } from './create-engine-host.js';
import type { EngineCanvas } from './engine-host-platform.js';

class SwitchingPlatform extends FakeHostPlatform {
  override async createBackend(canvas: EngineCanvas, options: CreateGpuBackendOptions) {
    const backend = await super.createBackend(canvas, options);
    Object.assign(backend.capabilities, { backendName: options.prefer });
    return backend;
  }
}

class PageCanvas extends FakeCanvas {
  readonly style: Record<string, string> = {};
  readonly inserted: PageCanvas[] = [];
  readonly ownerDocument = {
    createElement: (tag: string): PageCanvas => {
      expect(tag).toBe('canvas');
      return new PageCanvas(this.width, this.height);
    },
  };

  after(canvas: PageCanvas): void {
    this.inserted.push(canvas);
  }
}

async function settleRecovery(): Promise<void> {
  for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();
}

describe('main-thread host fallback canvas', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('overlays a WebGL2 canvas while the original remains transparent and receives input', async () => {
    const platform = new SwitchingPlatform();
    const original = new PageCanvas();
    const changed = vi.fn();
    vi.stubGlobal('document', original.ownerDocument);
    const host = await createEngineHost(original, {
      platform,
      prefer: 'main',
      backend: 'webgpu',
      onBackendChanged: changed,
    });
    expect(host.capabilities.backendName).toBe('webgpu');
    const first = platform.backends[0];
    if (first === undefined) throw new Error('No initial backend.');
    first.loseDevice();
    await settleRecovery();

    const fallback = original.inserted[0];
    expect(fallback).toBeDefined();
    expect(original.inserted).toHaveLength(1);
    expect(fallback).not.toBe(original);
    expect(fallback?.style.position).toBe('absolute');
    expect(fallback?.style.pointerEvents).toBe('none');
    expect(original.style.opacity).toBe('0');
    expect(host.capabilities.backendName).toBe('webgl2');
    expect(changed).toHaveBeenCalledExactlyOnceWith('webgl2');
    expect(platform.backendOptions.at(-1)).toMatchObject({ prefer: 'webgl2' });

    host.resize(8, 6, 1);
    expect([fallback?.width, fallback?.height]).toEqual([8, 6]);
    expect([original.width, original.height]).toEqual([4, 2]);
    host.destroy();
  });
});
