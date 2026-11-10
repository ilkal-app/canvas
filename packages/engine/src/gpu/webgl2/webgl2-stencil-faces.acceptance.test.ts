import { describe, expect, it } from 'vitest';

import type { GpuRenderPipelineDescriptor, GpuStencilOperation } from '../gpu-pipeline.js';
import { ResourceTracker } from '../resource-tracker.js';

import { WebGl2Pipeline } from './webgl2-pipeline.js';
import { WebGl2ProgramCache } from './webgl2-program-cache.js';

// Record the applied GL state without requiring a browser or rasterized pixels.
const OPERATIONS = [
  'keep',
  'zero',
  'invert',
  'increment-wrap',
  'decrement-wrap',
] as const satisfies readonly GpuStencilOperation[];
const FACE_PAIRS = OPERATIONS.map((operation, index) => ({
  operation,
  front: OPERATIONS[(index + 1) % OPERATIONS.length] ?? 'keep',
}));

const GL_OPERATIONS = {
  keep: 'KEEP',
  zero: 'ZERO',
  invert: 'INVERT',
  'increment-wrap': 'INCR_WRAP',
  'decrement-wrap': 'DECR_WRAP',
} as const;

const ENUMS = {
  ALWAYS: 'ALWAYS',
  NOTEQUAL: 'NOTEQUAL',
  KEEP: 'KEEP',
  ZERO: 'ZERO',
  INVERT: 'INVERT',
  INCR_WRAP: 'INCR_WRAP',
  DECR_WRAP: 'DECR_WRAP',
  FRONT: 'FRONT',
  BACK: 'BACK',
  STENCIL_TEST: 'STENCIL_TEST',
  CULL_FACE: 'CULL_FACE',
  BLEND: 'BLEND',
};

type GlCall = readonly [string, ...unknown[]];

function recordedPipeline(
  stencil: GpuRenderPipelineDescriptor['stencil'],
  colorWrite: 'all' | 'none' = 'none',
) {
  const calls: GlCall[] = [];
  const known: Record<string, unknown> = { ...ENUMS, createVertexArray: () => ({}) };
  const gl = new Proxy(known, {
    get(target, property: string) {
      if (property in target) return target[property];
      return (...args: unknown[]) => {
        calls.push([property, ...args]);
      };
    },
  }) as unknown as WebGL2RenderingContext;
  const programs = new WebGl2ProgramCache(gl, () => ({}));
  const pipeline = new WebGl2Pipeline(
    gl,
    {
      shader: {
        label: 'stencil faces',
        wgsl: '',
        vertexEntryPoint: 'vs',
        fragmentEntryPoint: 'fs',
        glslVertex: '',
        glslFragment: '',
      },
      vertexBuffers: [],
      bindings: [],
      blend: 'none',
      colorWrite,
      ...(stencil === undefined ? {} : { stencil }),
    },
    new ResourceTracker(),
    programs,
  );
  pipeline.apply();
  const named = (name: string) => calls.filter(([call]) => call === name);
  return { calls, named };
}

describe('WebGL2 stencil faces', () => {
  it.each(OPERATIONS)('maps %s on the front and defaulted back face', (operation) => {
    const { calls, named } = recordedPipeline({ compare: 'always', passOperation: operation });
    const expected = GL_OPERATIONS[operation];
    expect(named('stencilOpSeparate')).toEqual([
      ['stencilOpSeparate', 'FRONT', 'KEEP', 'KEEP', expected],
      ['stencilOpSeparate', 'BACK', 'KEEP', 'KEEP', expected],
    ]);
    expect(named('stencilOp')).toEqual([]);
    expect(calls).toContainEqual(['stencilFunc', 'ALWAYS', 0, 0xff]);
    expect(calls).not.toContainEqual(['enable', 'CULL_FACE']);
  });

  it.each(FACE_PAIRS)('maps $operation on the back face independently', ({ operation, front }) => {
    const { named } = recordedPipeline({
      compare: 'always',
      passOperation: front,
      backPassOperation: operation,
    });
    expect(named('stencilOpSeparate')).toEqual([
      ['stencilOpSeparate', 'FRONT', 'KEEP', 'KEEP', GL_OPERATIONS[front]],
      ['stencilOpSeparate', 'BACK', 'KEEP', 'KEEP', GL_OPERATIONS[operation]],
    ]);
  });

  it('uses opposite wrap operations for a non-zero fan and clears its cover', () => {
    const fan = recordedPipeline({
      compare: 'always',
      passOperation: 'increment-wrap',
      backPassOperation: 'decrement-wrap',
    });
    expect(fan.named('colorMask')).toEqual([['colorMask', false, false, false, false]]);
    expect(fan.named('stencilOpSeparate')).toEqual([
      ['stencilOpSeparate', 'FRONT', 'KEEP', 'KEEP', 'INCR_WRAP'],
      ['stencilOpSeparate', 'BACK', 'KEEP', 'KEEP', 'DECR_WRAP'],
    ]);
    const cover = recordedPipeline({ compare: 'not-equal', passOperation: 'zero' }, 'all');
    expect(cover.named('colorMask')).toEqual([['colorMask', true, true, true, true]]);
    expect(cover.named('stencilFunc')).toEqual([['stencilFunc', 'NOTEQUAL', 0, 0xff]]);
    expect(cover.named('stencilOpSeparate')).toEqual([
      ['stencilOpSeparate', 'FRONT', 'KEEP', 'KEEP', 'ZERO'],
      ['stencilOpSeparate', 'BACK', 'KEEP', 'KEEP', 'ZERO'],
    ]);
  });

  it('preserves even-odd invert fans and not-equal zero covers on both faces', () => {
    for (const [compare, passOperation, glCompare, glOperation] of [
      ['always', 'invert', 'ALWAYS', 'INVERT'],
      ['not-equal', 'zero', 'NOTEQUAL', 'ZERO'],
    ] as const) {
      const { named } = recordedPipeline({ compare, passOperation });
      expect(named('stencilFunc')).toEqual([['stencilFunc', glCompare, 0, 0xff]]);
      expect(named('stencilMask')).toEqual([['stencilMask', 0xff]]);
      expect(named('stencilOpSeparate')).toEqual([
        ['stencilOpSeparate', 'FRONT', 'KEEP', 'KEEP', glOperation],
        ['stencilOpSeparate', 'BACK', 'KEEP', 'KEEP', glOperation],
      ]);
    }
  });
});
