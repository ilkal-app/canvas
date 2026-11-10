import { describe, expect, it, vi } from 'vitest';

import type { GpuBackend } from './gpu-backend.js';
import type { GpuBackendName } from './gpu-capabilities.js';
import type { GpuRenderPassDescriptor } from './gpu-render-pass.js';
import type { GpuRenderTarget } from './gpu-render-target.js';
import {
  assertLayerComposite,
  createLayerCompositePipeline,
  drawLayerComposite,
  layerCompositePlacement,
  layerCompositeResources,
  layerCompositeUniform,
  recordLayerComposite,
} from './layer-composite-pass.js';
import { LAYER_COMPOSITE_SHADER } from './shaders/layer-composite.generated.js';

/**
 * A backend that records the calls a composite makes; every handle is a fresh object.
 *
 * @param backendName - The backend it claims to be.
 * @returns The backend and its recorded calls.
 */
function recordingBackend(backendName: GpuBackendName = 'webgpu') {
  const calls: (readonly [string, ...unknown[]])[] = [];
  const record =
    <T>(name: string, result: (...args: never[]) => T) =>
    (...args: never[]): T => {
      calls.push([name, ...args]);
      return result(...args);
    };
  const pass = {
    setViewport: record('pass.setViewport', () => undefined),
    setPipeline: record('pass.setPipeline', () => undefined),
    setBindGroup: record('pass.setBindGroup', () => undefined),
    setVertexBuffer: record('pass.setVertexBuffer', () => undefined),
    draw: record('pass.draw', () => undefined),
    end: record('pass.end', () => undefined),
  };
  const backend = {
    capabilities: { backendName },
    createBuffer: record('createBuffer', () => ({})),
    writeBuffer: record('writeBuffer', () => undefined),
    createSampler: record('createSampler', () => ({})),
    createRenderPipeline: record('createRenderPipeline', () => ({})),
    createBindGroup: record('createBindGroup', () => ({})),
    beginRenderPass: record('beginRenderPass', () => pass),
  } as unknown as GpuBackend;
  return { backend, calls };
}

const target: GpuRenderTarget = {
  width: 80,
  height: 64,
  texture: { format: 'rgba8unorm', width: 80, height: 64, destroy: () => undefined },
  destroy: () => undefined,
};

const RECT = { x: 40, y: 24, width: 80, height: 64 };

describe('layer composite', () => {
  it('compiles layer-composite.wgsl blending premultiplied, with uniform, texture and sampler', () => {
    const { backend } = recordingBackend();
    const create = vi.spyOn(backend, 'createRenderPipeline');
    createLayerCompositePipeline(backend);
    expect(create).toHaveBeenCalledWith({
      label: 'layer-composite',
      shader: LAYER_COMPOSITE_SHADER,
      vertexBuffers: [{ stepMode: 'vertex', attributes: [{ location: 0, format: 'float32x2' }] }],
      bindings: [
        { binding: 0, kind: 'uniform-buffer' },
        { binding: 1, kind: 'texture', samplerBinding: 2 },
        { binding: 2, kind: 'sampler' },
      ],
      blend: 'premultiplied',
    });
  });

  it('packs the opacity, the row flip, the uv scale and the clip rectangle into 32 bytes', () => {
    expect([...layerCompositeUniform(0.5, true)]).toEqual([0.5, 1, 1, 1, -1, 1, 1, -1]);
    expect([...layerCompositeUniform(1, false)]).toEqual([1, 0, 1, 1, -1, 1, 1, -1]);
  });

  it('draws the target over the canvas in its own pass, with the viewport on the rectangle', () => {
    const { backend, calls } = recordingBackend();
    drawLayerComposite(backend, target, RECT, 0.5);
    const names = calls.map(([name]) => name);
    expect(names.slice(-9, -1)).toEqual([
      'writeBuffer',
      'createBindGroup',
      'beginRenderPass',
      'pass.setViewport',
      'pass.setPipeline',
      'pass.setBindGroup',
      'pass.setVertexBuffer',
      'pass.draw',
    ]);
    expect(calls.at(-1)).toEqual(['pass.end']);
    const begin = calls.find(([name]) => name === 'beginRenderPass');
    // A canvas pass that loads what earlier passes drew.
    expect(begin?.[1]).toEqual({} satisfies GpuRenderPassDescriptor);
    expect(calls.find(([name]) => name === 'pass.setViewport')?.[1]).toEqual(RECT);
    expect(calls.find(([name]) => name === 'pass.draw')?.[1]).toBe(6);
    const writes = calls.filter(([name]) => name === 'writeBuffer');
    expect([...(writes.at(-1)?.[3] as Float32Array)]).toEqual([0.5, 0, 1, 1, -1, 1, 1, -1]);
    const group = calls.find(([name]) => name === 'createBindGroup')?.[1] as {
      entries: readonly { binding: number; texture?: unknown }[];
    };
    expect(group.entries.find(({ binding }) => binding === 1)?.texture).toBe(target.texture);
  });

  it('compiles its pipeline and makes its buffers once per backend', () => {
    const { backend, calls } = recordingBackend();
    drawLayerComposite(backend, target, RECT, 1);
    drawLayerComposite(backend, target, RECT, 0.25);
    const count = (name: string) => calls.filter(([call]) => call === name).length;
    expect(count('createRenderPipeline')).toBe(1);
    expect(count('createBuffer')).toBe(2);
    expect(count('createSampler')).toBe(1);
    expect(count('beginRenderPass')).toBe(2);
    const other = recordingBackend();
    drawLayerComposite(other.backend, target, RECT, 1);
    expect(other.calls.filter(([call]) => call === 'createRenderPipeline')).toHaveLength(1);
  });

  it('samples the nearest texel and never repeats', () => {
    const { backend, calls } = recordingBackend();
    drawLayerComposite(backend, target, RECT, 1);
    expect(calls.find(([name]) => name === 'createSampler')?.[1]).toMatchObject({
      filter: 'nearest',
      addressMode: 'clamp-to-edge',
    });
  });

  it('flips rows on WebGL2', () => {
    const { backend, calls } = recordingBackend('webgl2');
    drawLayerComposite(backend, target, RECT, 0.75);
    const writes = calls.filter(([name]) => name === 'writeBuffer');
    expect([...(writes.at(-1)?.[3] as Float32Array)]).toEqual([0.75, 1, 1, 1, -1, 1, 1, -1]);
  });

  it('rejects a rectangle off whole canvas pixels, of another size, or a bad opacity', () => {
    for (const rect of [
      { ...RECT, x: -1 },
      { ...RECT, y: 0.5 },
      { ...RECT, width: 81 },
      { ...RECT, height: 63 },
    ]) {
      expect(() => {
        assertLayerComposite(target, rect, 1);
      }).toThrow(RangeError);
    }
    for (const opacity of [-0.1, 1.1, Number.NaN]) {
      expect(() => {
        assertLayerComposite(target, RECT, opacity);
      }).toThrow(RangeError);
    }
    const { backend, calls } = recordingBackend();
    expect(() => {
      drawLayerComposite(backend, target, { ...RECT, width: 1 }, 1);
    }).toThrow(RangeError);
    expect(calls).toEqual([]);
    expect(() => {
      assertLayerComposite(target, { ...RECT, x: 0, y: 0 }, 0);
    }).not.toThrow();
  });

  it('places a composite inside an open pass by clip rectangle and the target’s drawn part', () => {
    const placement = layerCompositePlacement(
      { x: 100, y: 50, width: 50, height: 25 },
      { width: 200, height: 100 },
      { width: 100, height: 50 },
    );
    expect(placement).toEqual({ clip: [0, 0, 0.5, -0.5], uvScale: [0.5, 0.5] });
    expect([...layerCompositeUniform(1, true, placement)]).toEqual([
      1, 1, 0.5, 0.5, 0, 0, 0.5, -0.5,
    ]);
  });

  it('records a composite into an open pass without touching its viewport', () => {
    const { backend, calls } = recordingBackend();
    const resources = layerCompositeResources(backend);
    expect(layerCompositeResources(backend)).toBe(resources);
    const bindGroup = backend.createBindGroup({ pipeline: resources.pipeline, entries: [] });
    const pass = backend.beginRenderPass({});
    calls.length = 0;
    recordLayerComposite(pass, resources, bindGroup, 7);
    expect(calls.map(([name]) => name)).toEqual([
      'pass.setPipeline',
      'pass.setBindGroup',
      'pass.setVertexBuffer',
      'pass.draw',
    ]);
    expect(calls.at(-1)).toEqual(['pass.draw', 6, 1, 0, 7]);
    calls.length = 0;
    recordLayerComposite(pass, resources, bindGroup);
    expect(calls.at(-1)).toEqual(['pass.draw', 6, 1, 0, 0]);
  });
});
