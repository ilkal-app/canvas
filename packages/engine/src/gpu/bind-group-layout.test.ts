import { describe, expect, it } from 'vitest';

import { resolveBindGroupEntries } from './bind-group-layout.js';
import type { GpuBuffer } from './gpu-buffer.js';
import type { GpuBindingLayoutEntry } from './gpu-pipeline.js';
import type { GpuSampler, GpuTexture } from './gpu-texture.js';

const UNIFORMS = { usage: 'uniform', byteLength: 16 } as unknown as GpuBuffer;
const ATLAS = { format: 'rgba8unorm', width: 4, height: 4 } as unknown as GpuTexture;
const LINEAR = { filter: 'linear', addressMode: 'clamp-to-edge' } as unknown as GpuSampler;

const TEXTURED_BINDINGS: GpuBindingLayoutEntry[] = [
  { binding: 0, kind: 'uniform-buffer' },
  { binding: 1, kind: 'texture', samplerBinding: 2 },
  { binding: 2, kind: 'sampler' },
];

describe('resolveBindGroupEntries', () => {
  it('binds an absolute float texture for texel loads without a filtering sampler', () => {
    const table = { ...ATLAS, format: 'rgba32float' } as GpuTexture;
    const resolved = resolveBindGroupEntries(
      [{ binding: 4, kind: 'load-texture' }],
      [{ binding: 4, texture: table }],
    );
    expect(resolved.textures).toEqual([{ binding: 4, texture: table, sampler: undefined }]);
    expect(resolved.samplers).toEqual([]);
  });

  it('rejects float32 tables in the ordinary filterable texture binding', () => {
    const table = { ...ATLAS, format: 'rgba32float' } as GpuTexture;
    expect(() =>
      resolveBindGroupEntries(TEXTURED_BINDINGS, [
        { binding: 0, buffer: UNIFORMS },
        { binding: 1, texture: table },
        { binding: 2, sampler: LINEAR },
      ]),
    ).toThrow(/unfilterable/);
  });

  it('pairs each texture with the sampler its layout entry names', () => {
    const resolved = resolveBindGroupEntries(TEXTURED_BINDINGS, [
      { binding: 2, sampler: LINEAR },
      { binding: 0, buffer: UNIFORMS },
      { binding: 1, texture: ATLAS },
    ]);
    expect(resolved.uniformBuffers).toEqual([{ binding: 0, buffer: UNIFORMS }]);
    expect(resolved.textures).toEqual([{ binding: 1, texture: ATLAS, sampler: LINEAR }]);
  });

  it('rejects a group that leaves a declared binding empty', () => {
    expect(() =>
      resolveBindGroupEntries(TEXTURED_BINDINGS, [
        { binding: 0, buffer: UNIFORMS },
        { binding: 1, texture: ATLAS },
      ]),
    ).toThrow(/binding 2/);
  });

  it('rejects a resource of the wrong kind for its binding', () => {
    expect(() =>
      resolveBindGroupEntries(TEXTURED_BINDINGS, [
        { binding: 0, texture: ATLAS },
        { binding: 1, texture: ATLAS },
        { binding: 2, sampler: LINEAR },
      ]),
    ).toThrow(/binding 0/);
  });

  it('rejects an entry for a binding the pipeline does not declare', () => {
    expect(() =>
      resolveBindGroupEntries(
        [{ binding: 0, kind: 'uniform-buffer' }],
        [
          { binding: 0, buffer: UNIFORMS },
          { binding: 5, buffer: UNIFORMS },
        ],
      ),
    ).toThrow(/binding 5/);
  });

  it('rejects a uniform binding bound to a vertex buffer', () => {
    const vertices = { usage: 'vertex', byteLength: 16 } as unknown as GpuBuffer;
    expect(() =>
      resolveBindGroupEntries(
        [{ binding: 0, kind: 'uniform-buffer' }],
        [{ binding: 0, buffer: vertices }],
      ),
    ).toThrow(/uniform/);
  });
});
