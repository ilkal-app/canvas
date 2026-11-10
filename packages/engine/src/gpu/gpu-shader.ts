/**
 * One render pass's shaders. WGSL is the single source; the GLSL ES 3.0 stages are generated
 * from it at build time by naga (`pnpm --filter @canvas/engine shaders`),
 * committed next to the `.wgsl` file, and embedded in a generated `*.generated.ts` module that
 * exports one of these.
 */
export interface GpuShaderSource {
  /** The shader's name, used as the GPU debug label. */
  readonly label: string;
  /** The WGSL source, compiled by the WebGPU backend. */
  readonly wgsl: string;
  /** The WGSL vertex entry point. */
  readonly vertexEntryPoint: string;
  /** The WGSL fragment entry point. */
  readonly fragmentEntryPoint: string;
  /** The vertex stage in GLSL ES 3.0, generated from `wgsl`; compiled by the WebGL2 backend. */
  readonly glslVertex: string;
  /** The fragment stage in GLSL ES 3.0, generated from `wgsl`; compiled by the WebGL2 backend. */
  readonly glslFragment: string;
}
