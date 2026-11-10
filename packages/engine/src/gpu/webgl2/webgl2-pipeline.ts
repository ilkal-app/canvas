import type {
  GpuBindingLayoutEntry,
  GpuBlendMode,
  GpuColorWrite,
  GpuCompareFunction,
  GpuRenderPipeline,
  GpuRenderPipelineDescriptor,
  GpuStencilOperation,
  GpuStencilState,
} from '../gpu-pipeline.js';
import type { GpuShaderSource } from '../gpu-shader.js';
import type { ResourceTracker } from '../resource-tracker.js';
import { resolveVertexBufferLayouts } from '../vertex-layout.js';
import type { ResolvedVertexBufferLayout } from '../vertex-layout.js';

import type { WebGl2ProgramCache } from './webgl2-program-cache.js';

/** Stencil masks: all 8 bits read and written, as the prototype's even-odd fill used. */
const STENCIL_MASK = 0xff;

/** The stencil reference every test compares against. */
const STENCIL_REFERENCE = 0;

function compareToGl(gl: WebGL2RenderingContext, compare: GpuCompareFunction): GLenum {
  switch (compare) {
    case 'always':
      return gl.ALWAYS;
    case 'equal':
      return gl.EQUAL;
    case 'not-equal':
      return gl.NOTEQUAL;
  }
}

function stencilOperationToGl(gl: WebGL2RenderingContext, operation: GpuStencilOperation): GLenum {
  switch (operation) {
    case 'keep':
      return gl.KEEP;
    case 'zero':
      return gl.ZERO;
    case 'replace':
      return gl.REPLACE;
    case 'invert':
      return gl.INVERT;
    case 'increment-wrap':
      return gl.INCR_WRAP;
    case 'decrement-wrap':
      return gl.DECR_WRAP;
  }
}

/**
 * A WebGL2 pipeline: a linked program, a vertex array object with its attributes enabled and
 * divisors set, and the fixed-function state applied when it is selected.
 */
export class WebGl2Pipeline implements GpuRenderPipeline {
  /** The owning context. */
  readonly gl: WebGL2RenderingContext;
  /** The group-0 bindings bind groups must fill. */
  readonly bindings: readonly GpuBindingLayoutEntry[];
  /** Vertex buffer layouts with offsets and strides, in slot order. */
  readonly vertexBuffers: readonly ResolvedVertexBufferLayout[];
  /** The vertex array object holding enabled attributes and their divisors. */
  readonly vertexArray: WebGLVertexArrayObject;
  private readonly program: WebGLProgram;
  private readonly shader: GpuShaderSource;
  private isDestroyed = false;
  private readonly blend: GpuBlendMode;
  private readonly colorWrite: GpuColorWrite;
  private readonly stencil: GpuStencilState | undefined;

  /**
   * Compiles the pipeline's program and builds its vertex array object.
   *
   * @param gl - The owning context.
   * @param descriptor - The pipeline description.
   * @param tracker - The backend's live resources; the pipeline adds itself once built.
   * @param programs - The context's programs, one per shader, shared with other pipelines.
   */
  constructor(
    gl: WebGL2RenderingContext,
    descriptor: GpuRenderPipelineDescriptor,
    private readonly tracker: ResourceTracker,
    private readonly programs: WebGl2ProgramCache,
  ) {
    this.gl = gl;
    this.bindings = descriptor.bindings;
    this.vertexBuffers = resolveVertexBufferLayouts(descriptor.vertexBuffers);
    this.shader = descriptor.shader;
    this.program = programs.acquire(descriptor.shader);
    this.blend = descriptor.blend;
    this.colorWrite = descriptor.colorWrite ?? 'all';
    this.stencil = descriptor.stencil;
    this.vertexArray = gl.createVertexArray();
    gl.bindVertexArray(this.vertexArray);
    for (const layout of this.vertexBuffers) {
      for (const attribute of layout.attributes) {
        gl.enableVertexAttribArray(attribute.location);
        gl.vertexAttribDivisor(attribute.location, layout.stepMode === 'instance' ? 1 : 0);
      }
    }
    gl.bindVertexArray(null);
    tracker.track(this);
  }

  /**
   * Frees the vertex array object and gives back its hold on the shared program, which is
   * deleted with its last pipeline; later calls do nothing.
   */
  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.programs.release(this.shader);
    this.gl.deleteVertexArray(this.vertexArray);
    this.tracker.untrack(this);
  }

  /** Makes this pipeline's program, blending, colour mask and stencil test current. */
  apply(): void {
    const { gl } = this;
    gl.useProgram(this.program);
    if (this.blend === 'premultiplied') {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      gl.disable(gl.BLEND);
    }
    const isColorWritten = this.colorWrite === 'all';
    gl.colorMask(isColorWritten, isColorWritten, isColorWritten, isColorWritten);
    if (this.stencil) {
      gl.enable(gl.STENCIL_TEST);
      const compare = compareToGl(gl, this.stencil.compare);
      const reference = this.stencil.reference ?? STENCIL_REFERENCE;
      const readMask = this.stencil.readMask ?? STENCIL_MASK;
      const writeMask = this.stencil.writeMask ?? STENCIL_MASK;
      // Both faces share the test and the masks; only the operations differ by face.
      gl.stencilFunc(compare, reference, readMask);
      gl.stencilMask(writeMask);
      // Each face has its own operation (a non-zero fill counts front faces up and back
      // faces down); without a back operation both take the pass operation.
      const front = this.stencil.passOperation;
      const back = this.stencil.backPassOperation ?? front;
      gl.stencilOpSeparate(gl.FRONT, gl.KEEP, gl.KEEP, stencilOperationToGl(gl, front));
      gl.stencilOpSeparate(gl.BACK, gl.KEEP, gl.KEEP, stencilOperationToGl(gl, back));
    } else {
      gl.disable(gl.STENCIL_TEST);
    }
  }
}
