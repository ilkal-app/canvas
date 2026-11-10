import type { GpuCapabilities } from '../gpu-capabilities.js';
import { isSoftwareAdapterName } from '../software-adapter.js';

/** The context facts capability resolution needs, as plain data so it is testable without a GPU. */
export interface WebGl2ContextFacts {
  /** `MAX_TEXTURE_SIZE`, in texels. */
  readonly maxTextureSize: number;
  /** `WEBGL_debug_renderer_info`'s unmasked renderer, else `RENDERER`. */
  readonly rendererName: string;
  /** Whether `EXT_disjoint_timer_query_webgl2` is available. */
  readonly hasTimerQuery: boolean;
  /** The default framebuffer's `SAMPLES`: 0 when it is not multisampled. */
  readonly samples: number;
}

/** The renderer Chrome reports in `RENDERER`, masking the real one. */
const MASKED_RENDERER = 'WebKit WebGL';

/**
 * A context's renderer name: `RENDERER`, unless it is Chrome's masked one, and only then the
 * `WEBGL_debug_renderer_info` extension's unmasked renderer, which Firefox deprecates and warns
 * about when it is asked for.
 *
 * @param read - Reads `RENDERER`, and the extension's unmasked renderer.
 * @param read.renderer - Reads `gl.RENDERER`.
 * @param read.unmaskedRenderer - Reads the unmasked renderer through the extension.
 * @returns The name; `''` when `RENDERER` is not a string.
 */
export function readRendererName(read: {
  readonly renderer: () => unknown;
  readonly unmaskedRenderer: () => unknown;
}): string {
  const renderer = read.renderer();
  if (typeof renderer !== 'string') return '';
  if (renderer !== MASKED_RENDERER) return renderer;
  const unmasked = read.unmaskedRenderer();
  return typeof unmasked === 'string' && unmasked !== '' ? unmasked : renderer;
}

/**
 * Resolves the capabilities of a WebGL2 context.
 *
 * @param facts - The context's limits, renderer and extensions.
 * @returns The backend's capabilities.
 */
export function resolveWebGl2Capabilities(facts: WebGl2ContextFacts): GpuCapabilities {
  return {
    backendName: 'webgl2',
    maxTextureSize: facts.maxTextureSize,
    hasTimestampQuery: facts.hasTimerQuery,
    sampleCount: Math.max(1, facts.samples),
    adapterName: facts.rendererName,
    isSoftwareAdapter: isSoftwareAdapterName(facts.rendererName),
  };
}
