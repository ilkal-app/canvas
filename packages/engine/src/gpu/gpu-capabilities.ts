/** Which implementation of the `GpuBackend` interface is running. */
export type GpuBackendName = 'webgpu' | 'webgl2';

/** The number of samples per pixel the backend renders with: 1 (aliased) or 4 (4× MSAA). */
export type GpuSampleCount = 1 | 4;

/**
 * What the running backend can do, resolved once when it is created. Renderers read it to pick
 * texture sizes and to decide whether GPU pass timings exist; tests read it to refuse software
 * adapters (Global Constraint 3).
 */
export interface GpuCapabilities {
  /** The implementation behind the interface. */
  readonly backendName: GpuBackendName;
  /** The largest width or height a 2D texture may have, in texels. */
  readonly maxTextureSize: number;
  /**
   * Whether labelled passes report GPU durations: WebGPU `timestamp-query`, or
   * `EXT_disjoint_timer_query_webgl2` on WebGL2.
   * When false, `collectPassTimings` resolves to an empty list.
   */
  readonly hasTimestampQuery: boolean;
  /**
   * Samples per pixel the canvas render target actually has: the requested {@link GpuSampleCount}
   * on WebGPU, the drawing buffer's `SAMPLES` on WebGL2 (1 when it is not multisampled).
   */
  readonly sampleCount: number;
  /**
   * The adapter or renderer description for diagnostics, for example
   * `ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Max, …)`; empty when the browser hides it.
   */
  readonly adapterName: string;
  /**
   * Whether the adapter is a software rasterizer (SwiftShader, llvmpipe, WARP or a WebGPU
   * fallback adapter). Rendering is never judged on one: it garbles SDF and MSDF edges.
   */
  readonly isSoftwareAdapter: boolean;
}
