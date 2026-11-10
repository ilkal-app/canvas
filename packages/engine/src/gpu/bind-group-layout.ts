import type { GpuBindGroupEntry } from './gpu-bind-group.js';
import type { GpuBuffer } from './gpu-buffer.js';
import type { GpuBindingLayoutEntry } from './gpu-pipeline.js';
import type { GpuSampler, GpuTexture } from './gpu-texture.js';

/** A bind group's resources, sorted by kind, each checked against the pipeline's bindings. */
export interface ResolvedBindGroupEntries {
  /** Uniform buffers by binding. */
  readonly uniformBuffers: readonly { readonly binding: number; readonly buffer: GpuBuffer }[];
  /** Textures by binding, each with the sampler its layout entry names. */
  readonly textures: readonly {
    readonly binding: number;
    readonly texture: GpuTexture;
    readonly sampler: GpuSampler | undefined;
  }[];
  /** Samplers by binding. */
  readonly samplers: readonly { readonly binding: number; readonly sampler: GpuSampler }[];
}

/**
 * Checks a bind group's entries against a pipeline's declared bindings and pairs every texture
 * with its sampler (WebGL2 binds them to one texture unit).
 *
 * @param bindings - The pipeline's group-0 bindings.
 * @param entries - One resource per binding, in any order.
 * @returns The resources sorted by kind.
 * @throws {RangeError} When a binding is missing, undeclared or given the wrong kind of resource.
 */
export function resolveBindGroupEntries(
  bindings: readonly GpuBindingLayoutEntry[],
  entries: readonly GpuBindGroupEntry[],
): ResolvedBindGroupEntries {
  const byBinding = new Map(entries.map((entry) => [entry.binding, entry]));
  for (const entry of entries) {
    if (!bindings.some((layout) => layout.binding === entry.binding)) {
      throw new RangeError(`The pipeline declares no binding ${String(entry.binding)}.`);
    }
  }
  const samplerAt = (binding: number): GpuSampler => {
    const entry = byBinding.get(binding);
    if (entry && 'sampler' in entry) {
      return entry.sampler;
    }
    throw new RangeError(`Expected a sampler at binding ${String(binding)}.`);
  };
  const uniformBuffers = [];
  const textures = [];
  const samplers = [];
  for (const layout of bindings) {
    const entry = byBinding.get(layout.binding);
    if (layout.kind === 'uniform-buffer') {
      if (!entry || !('buffer' in entry) || entry.buffer.usage !== 'uniform') {
        throw new RangeError(`Expected a uniform buffer at binding ${String(layout.binding)}.`);
      }
      uniformBuffers.push({ binding: layout.binding, buffer: entry.buffer });
    } else if (layout.kind === 'texture' || layout.kind === 'load-texture') {
      if (!entry || !('texture' in entry)) {
        throw new RangeError(`Expected a texture at binding ${String(layout.binding)}.`);
      }
      if (layout.kind === 'texture' && entry.texture.format === 'rgba32float') {
        throw new RangeError('rgba32float is unfilterable; use a load-texture binding.');
      }
      const sampler = layout.kind === 'texture' ? samplerAt(layout.samplerBinding) : undefined;
      textures.push({ binding: layout.binding, texture: entry.texture, sampler });
    } else {
      samplers.push({ binding: layout.binding, sampler: samplerAt(layout.binding) });
    }
  }
  return { uniformBuffers, textures, samplers };
}
