import type { GpuShaderSource } from './gpu-shader.js';
import type { GpuVertexBufferLayout } from './vertex-layout.js';

/**
 * How fragment output combines with the target. `premultiplied` is `src + dst × (1 − srcα)` for
 * colour and alpha: shaders output premultiplied colour, as every prototype renderer did.
 */
export type GpuBlendMode = 'none' | 'premultiplied';

/** Whether a pipeline writes colour; `none` is the stencil-only pass of an even-odd fill. */
export type GpuColorWrite = 'all' | 'none';

/** A stencil test, comparing the reference value 0 against the stored stencil value. */
export type GpuCompareFunction = 'always' | 'equal' | 'not-equal';

/**
 * What a fragment that passes the stencil test does to the stored stencil value. The wrapping
 * increment and decrement count a non-zero fill's windings.
 */
export type GpuStencilOperation =
  'keep' | 'zero' | 'replace' | 'invert' | 'increment-wrap' | 'decrement-wrap';

/**
 * A pipeline's stencil test. An even-odd fill is two draws (prototype `pathRenderer.ts`): the
 * fan triangles with `{ compare: 'always', passOperation: 'invert' }` and no colour, then a
 * cover quad with `{ compare: 'not-equal', passOperation: 'zero' }`, which paints where the
 * count is odd and leaves the stencil clear for the next fill. A non-zero fill (glyph
 * outlines, whose contours may overlap) counts windings instead: front faces
 * `increment-wrap`, back faces `decrement-wrap`, then the same cover, which paints where the count
 * is not 0. Which winding a backend calls front does not matter, as a sign flip leaves "not 0"
 * unchanged; no face is culled. The reference is 0 and the masks 0xff unless a state sets them
 * (the vector tier's edge strips mark painted samples with a bit of their own).
 */
export interface GpuStencilState {
  /** The test against the stored value. */
  readonly compare: GpuCompareFunction;
  /** What passing fragments do to the stored value (front-facing ones, when the back differs). */
  readonly passOperation: GpuStencilOperation;
  /** What passing back-facing fragments do; `passOperation` when absent. */
  readonly backPassOperation?: GpuStencilOperation;
  /** The value compared with, and written by `replace`, 0 to 255; 0 when absent. */
  readonly reference?: number;
  /** The bits the test compares, of the reference and the stored value; 0xff when absent. */
  readonly readMask?: number;
  /** The bits a passing fragment's operation may change; 0xff when absent. */
  readonly writeMask?: number;
}

/**
 * One entry of a pipeline's bind group (WGSL `@group(0) @binding(n)`). Only group 0 exists.
 * A `texture` entry names the `sampler` entry it is sampled with: GLSL ES 3.0 has combined
 * samplers only, so the WebGL2 backend pairs them at bind time.
 */
export type GpuBindingLayoutEntry =
  | {
      /** The WGSL `@binding` number. */
      readonly binding: number;
      /** Unfilterable `texture_2d<f32>` read with integer `textureLoad`, without a sampler. */
      readonly kind: 'load-texture';
    }
  | {
      /** The WGSL `@binding` number. */
      readonly binding: number;
      /** A uniform buffer (`var<uniform>`), visible to both stages. */
      readonly kind: 'uniform-buffer';
    }
  | {
      /** The WGSL `@binding` number. */
      readonly binding: number;
      /** A `texture_2d<f32>`. */
      readonly kind: 'texture';
      /** The binding of the sampler this texture is sampled with. */
      readonly samplerBinding: number;
    }
  | {
      /** The WGSL `@binding` number. */
      readonly binding: number;
      /** A filtering `sampler`. */
      readonly kind: 'sampler';
    };

/** How to create a {@link GpuRenderPipeline}: shaders plus every fixed-function state. */
export interface GpuRenderPipelineDescriptor {
  /** The pass's shaders; entry points and generated GLSL included. */
  readonly shader: GpuShaderSource;
  /** The vertex buffers, in slot order; their locations match the WGSL `@location`s. */
  readonly vertexBuffers: readonly GpuVertexBufferLayout[];
  /** The group-0 bindings the shaders use; empty when they use none. */
  readonly bindings: readonly GpuBindingLayoutEntry[];
  /** How output blends with the target. */
  readonly blend: GpuBlendMode;
  /** Whether colour is written. Default `all`. */
  readonly colorWrite?: GpuColorWrite;
  /** The stencil test; absent means no test and no stencil writes. */
  readonly stencil?: GpuStencilState;
  /** A name shown by GPU debuggers. */
  readonly label?: string;
}

/**
 * A compiled pipeline: shaders, vertex layout, blending and stencil state, drawing triangle
 * lists into the canvas.
 */
export interface GpuRenderPipeline {
  /** The group-0 bindings bind groups for this pipeline must fill. */
  readonly bindings: readonly GpuBindingLayoutEntry[];
  /**
   * Frees the compiled program and vertex state (WebGL2); WebGPU pipelines are released by
   * garbage collection. The handle must not be used afterwards.
   */
  destroy(): void;
}
