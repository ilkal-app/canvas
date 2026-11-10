// C2a/C2b acceptance: target creation, ownership, pass routing and composite state.
import { describe, expect, it, vi } from 'vitest';

import type { GpuBackend } from '../gpu/gpu-backend.js';
import type { GpuRenderPipelineDescriptor } from '../gpu/gpu-pipeline.js';
import type { GpuRenderPassDescriptor } from '../gpu/gpu-render-pass.js';
import type { GpuTexture } from '../gpu/gpu-texture.js';

import { FakeGpuBackend } from './__fixtures__/fake-gpu-backend.js';

interface AcceptanceTarget {
  readonly width: number;
  readonly height: number;
  readonly texture: GpuTexture;
  destroy(): void;
}

type TargetBackend = GpuBackend & {
  createRenderTarget(descriptor: { width: number; height: number }): AcceptanceTarget;
};

function backendWithTargets(backend: GpuBackend): TargetBackend {
  return backend;
}

describe('render targets', () => {
  it('rejects empty and oversized target dimensions, using the device limit', () => {
    const backend = backendWithTargets(new FakeGpuBackend({ maxTextureSize: 64 }));
    for (const [width, height] of [
      [0, 8],
      [8, 0],
      [65, 8],
      [8, 65],
    ] as const) {
      expect(() => backend.createRenderTarget({ width, height })).toThrow(RangeError);
    }
    const target = backend.createRenderTarget({ width: 64, height: 32 });
    expect([target.width, target.height, target.texture.format]).toEqual([64, 32, 'rgba8unorm']);
    target.destroy();
  });

  it('routes draws into the selected target and frees its sampleable colour on destroy', () => {
    const fake = new FakeGpuBackend();
    const backend = backendWithTargets(fake);
    const target = backend.createRenderTarget({ width: 32, height: 16 });
    const descriptor = { target, clearColor: [0, 0, 0, 0] } as GpuRenderPassDescriptor;
    const pass = backend.beginRenderPass(descriptor);
    pass.draw(6);
    pass.end();
    backend.submit();
    expect(fake.calls).toContainEqual(
      expect.objectContaining({ method: 'beginRenderPass', target }),
    );
    expect(fake.draws()).toContainEqual(expect.objectContaining({ target, vertexCount: 6 }));
    target.destroy();
    expect(fake.liveTextures()).not.toContain(target.texture);
  });

  it('drops target handles when the fake device is lost or destroyed', () => {
    const fake = new FakeGpuBackend();
    const first = fake.createRenderTarget({ width: 8, height: 8 });
    fake.loseDevice();
    expect(first.isDestroyed).toBe(true);
    const second = fake.createRenderTarget({ width: 8, height: 8 });
    fake.destroy();
    expect(second.isDestroyed).toBe(true);
  });

  it('rejects a live target created by another fake backend', () => {
    const first = new FakeGpuBackend();
    const second = new FakeGpuBackend();
    const foreign = first.createRenderTarget({ width: 8, height: 8 });
    expect(() => second.beginRenderPass({ target: foreign })).toThrow(/target|backend/i);
    expect(second.calls.some((call) => call.method === 'beginRenderPass')).toBe(false);
  });

  it('creates a premultiplied composite pipeline with a texture, sampler and opacity uniform', async () => {
    const fake = new FakeGpuBackend();
    const create = vi.spyOn(fake, 'createRenderPipeline');
    const { createLayerCompositePipeline } = await import('../gpu/layer-composite-pass.js');
    createLayerCompositePipeline(fake);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'layer-composite',
        blend: 'premultiplied',
        bindings: [
          { binding: 0, kind: 'uniform-buffer' },
          { binding: 1, kind: 'texture', samplerBinding: 2 },
          { binding: 2, kind: 'sampler' },
        ],
      } satisfies Partial<GpuRenderPipelineDescriptor>),
    );
  });
});
