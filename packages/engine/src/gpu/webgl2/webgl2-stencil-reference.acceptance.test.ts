import { describe, expect, it } from 'vitest';

import type { GpuRenderPipelineDescriptor } from '../gpu-pipeline.js';
import { ResourceTracker } from '../resource-tracker.js';

import { WebGl2Pipeline } from './webgl2-pipeline.js';
import { WebGl2ProgramCache } from './webgl2-program-cache.js';

type Call = readonly [string, ...unknown[]];

function fixture(stencil: NonNullable<GpuRenderPipelineDescriptor['stencil']>) {
  const calls: Call[] = [];
  const enums: Record<string, unknown> = {
    ALWAYS: 'ALWAYS',
    NOTEQUAL: 'NOTEQUAL',
    FRONT: 'FRONT',
    BACK: 'BACK',
    KEEP: 'KEEP',
    ZERO: 'ZERO',
    REPLACE: 'REPLACE',
    STENCIL_TEST: 'STENCIL_TEST',
    createVertexArray: () => ({}),
  };
  const gl = new Proxy(enums, {
    get(target, property: string) {
      if (property in target) return target[property];
      return (...args: unknown[]) => {
        calls.push([property, ...args]);
      };
    },
  }) as unknown as WebGL2RenderingContext;
  const pipeline = new WebGl2Pipeline(
    gl,
    {
      shader: {
        label: 'stencil reference',
        wgsl: '',
        vertexEntryPoint: 'vs',
        fragmentEntryPoint: 'fs',
        glslVertex: '',
        glslFragment: '',
      },
      vertexBuffers: [],
      bindings: [],
      blend: 'none',
      stencil,
    },
    new ResourceTracker(),
    new WebGl2ProgramCache(gl, () => ({})),
  );
  pipeline.apply();
  return (name: string) => calls.filter(([method]) => method === name);
}

describe('WebGL2 stencil reference and masks', () => {
  it('applies explicit reference and masks to both faces', () => {
    const named = fixture({
      compare: 'not-equal',
      passOperation: 'replace' as never,
      reference: 0x80,
      readMask: 0x80,
      writeMask: 0x7f,
    } as never);
    // Both faces share the test and masks, so the one-call forms set both (adapted by Claude).
    expect(named('stencilFunc')).toEqual([['stencilFunc', 'NOTEQUAL', 0x80, 0x80]]);
    expect(named('stencilMask')).toEqual([['stencilMask', 0x7f]]);
    expect(named('stencilOpSeparate')).toContainEqual([
      'stencilOpSeparate',
      'FRONT',
      'KEEP',
      'KEEP',
      'REPLACE',
    ]);
  });

  it('preserves zero reference and 0xff masks on an existing pipeline', () => {
    const named = fixture({ compare: 'always', passOperation: 'zero' });
    expect(named('stencilFunc')).toEqual([['stencilFunc', 'ALWAYS', 0, 0xff]]);
    expect(named('stencilMask')).toEqual([['stencilMask', 0xff]]);
  });
});
