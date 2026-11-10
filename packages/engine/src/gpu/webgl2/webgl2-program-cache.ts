import type { GpuShaderSource } from '../gpu-shader.js';

import { createWebGl2Program } from './webgl2-program.js';

/** A cached program and how many pipelines hold it. */
interface CachedProgram {
  readonly program: WebGLProgram;
  users: number;
}

/**
 * The linked programs of one context, one per shader, as the WebGPU backend keeps one
 * shader module per shader: several pipelines draw with the same shader (every shape-shaped
 * pass with `sdf-shape`, the path passes with `path`), and each used to compile and link its
 * own copy, which on a software GPU is most of a pipeline's cost at engine start. A program's
 * state is its shader's alone (attribute locations from the GLSL, uniform blocks and samplers
 * tied to their WGSL bindings once after linking), so pipelines share it; each keeps its own
 * vertex array object and fixed-function state. A program is deleted when the last pipeline
 * holding it is destroyed.
 */
export class WebGl2ProgramCache {
  private readonly programs = new Map<GpuShaderSource, CachedProgram>();

  /**
   * Creates an empty cache.
   *
   * @param gl - The context the programs belong to.
   * @param link - Compiles and links a shader's program; `createWebGl2Program` by default.
   */
  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly link: (
      gl: WebGL2RenderingContext,
      shader: GpuShaderSource,
    ) => WebGLProgram = createWebGl2Program,
  ) {}

  /**
   * How many distinct programs are live.
   *
   * @returns The count.
   */
  get size(): number {
    return this.programs.size;
  }

  /**
   * The shader's program, linked on its first use; each call must be matched by a
   * {@link WebGl2ProgramCache.release}.
   *
   * @param shader - The shader.
   * @returns The linked program.
   */
  acquire(shader: GpuShaderSource): WebGLProgram {
    const cached = this.programs.get(shader);
    if (cached !== undefined) {
      cached.users += 1;
      return cached.program;
    }
    const program = this.link(this.gl, shader);
    this.programs.set(shader, { program, users: 1 });
    return program;
  }

  /**
   * Gives back one hold on the shader's program, deleting it when none is left; a shader not
   * held does nothing.
   *
   * @param shader - The shader.
   */
  release(shader: GpuShaderSource): void {
    const cached = this.programs.get(shader);
    if (cached === undefined) return;
    cached.users -= 1;
    if (cached.users > 0) return;
    this.programs.delete(shader);
    this.gl.deleteProgram(cached.program);
  }
}
