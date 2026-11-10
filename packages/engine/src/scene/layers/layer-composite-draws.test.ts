import { describe, expect, it } from 'vitest';

import { FakeGpuBackend } from '../__fixtures__/fake-gpu-backend.js';
import { emptyFrameStats, type FrameContext } from '../frame-context.js';

import { LayerCompositeDraws } from './layer-composite-draws.js';

const UNIFORM = new Float32Array(8);

function frame(timeMs: number): FrameContext {
  return { timeMs, stats: emptyFrameStats() } as FrameContext;
}

describe('LayerCompositeDraws', () => {
  it('files each draw under its destination and slot, reusing uniforms and bind groups', () => {
    const backend = new FakeGpuBackend();
    const draws = new LayerCompositeDraws(backend);
    const a = backend.createRenderTarget({ width: 64, height: 64 });
    const b = backend.createRenderTarget({ width: 64, height: 64 });
    const context = frame(0);
    draws.begin();
    draws.add('canvas', 3, a, UNIFORM, context);
    draws.add('canvas', 3, b, UNIFORM, context);
    draws.add('outer#1', 4, b, UNIFORM, context);
    expect(draws.into('canvas')?.get(3)).toHaveLength(2);
    expect(draws.into('outer#1')?.get(4)).toHaveLength(1);
    expect(draws.into('nowhere')).toBeUndefined();
    expect(context.stats).toMatchObject({ bufferWrites: 3, uploadedBytes: 96 });
    expect(draws.size).toBe(3);
    expect(draws.byteLength).toBe(96);
    const groups = backend.count('createBindGroup');
    draws.begin();
    draws.add('canvas', 3, a, UNIFORM, frame(16));
    draws.add('canvas', 3, a, UNIFORM, frame(16));
    // The first keeps its bind group; the second samples another target now.
    expect(backend.count('createBindGroup')).toBe(groups + 1);
    expect(draws.size).toBe(3);
  });

  it('frees the uniforms past a frame’s after two idle seconds, and all on destroy', () => {
    const backend = new FakeGpuBackend();
    const draws = new LayerCompositeDraws(backend);
    const target = backend.createRenderTarget({ width: 64, height: 64 });
    draws.begin();
    draws.add('canvas', 0, target, UNIFORM, frame(0));
    draws.add('canvas', 1, target, UNIFORM, frame(0));
    draws.begin();
    draws.add('canvas', 0, target, UNIFORM, frame(1000));
    draws.releaseIdle(2000);
    expect(draws.size).toBe(2);
    draws.releaseIdle(2001);
    expect(draws.size).toBe(1);
    draws.releaseIdle(9000);
    expect(draws.size).toBe(1);
    draws.destroyAll();
    expect(draws.size).toBe(0);
    expect(draws.into('canvas')).toBeUndefined();
    const uniforms = backend.buffers.filter(({ label }) => label === 'layer-composite layer');
    expect(uniforms.every(({ isDestroyed }) => isDestroyed)).toBe(true);
  });
});
