import type { GpuBuffer } from './gpu-buffer.js';
import type { GpuRenderPipeline } from './gpu-pipeline.js';
import type { GpuSampler, GpuTexture } from './gpu-texture.js';

/** The resource bound at one binding number: a uniform buffer, a texture or a sampler. */
export type GpuBindGroupEntry =
  | {
      /** The WGSL `@binding` number. */
      readonly binding: number;
      /** A `uniform` buffer, bound whole. */
      readonly buffer: GpuBuffer;
    }
  | {
      /** The WGSL `@binding` number. */
      readonly binding: number;
      /** A texture. */
      readonly texture: GpuTexture;
    }
  | {
      /** The WGSL `@binding` number. */
      readonly binding: number;
      /** A sampler. */
      readonly sampler: GpuSampler;
    };

/**
 * How to create a {@link GpuBindGroup}: one resource for every binding the pipeline declares.
 * The group may be used with any pipeline that declares the same bindings.
 */
export interface GpuBindGroupDescriptor {
  /** A pipeline whose bindings this group fills. */
  readonly pipeline: GpuRenderPipeline;
  /** The resources, one per declared binding. */
  readonly entries: readonly GpuBindGroupEntry[];
  /** A name shown by GPU debuggers. */
  readonly label?: string;
}

/**
 * A set of resources bound together for draws (WGSL group 0). It owns no GPU memory of its
 * own, so it has no `destroy`; destroying the resources it names is the caller's job.
 */
export interface GpuBindGroup {
  /** The resources, one per declared binding. */
  readonly entries: readonly GpuBindGroupEntry[];
}
