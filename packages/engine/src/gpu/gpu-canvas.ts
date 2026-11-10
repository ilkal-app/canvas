/**
 * What a backend renders into: a page canvas, or an `OffscreenCanvas` transferred to the worker
 * that runs the engine. The backend draws at its
 * `width × height` in device pixels; the caller sizes it.
 */
export type GpuCanvas = HTMLCanvasElement | OffscreenCanvas;

/** The one `getContext` overload each backend calls, shared by both canvas types. */
interface ContextSource {
  getContext(contextId: 'webgl2', options?: WebGLContextAttributes): WebGL2RenderingContext | null;
  getContext(contextId: 'webgpu'): GPUCanvasContext | null;
}

/**
 * Narrows either canvas type to the `getContext` overloads the backends use; the two DOM types'
 * overload lists are not callable as a union.
 *
 * @param canvas - The canvas to draw into.
 * @returns The same canvas, typed for `getContext('webgl2' | 'webgpu')`.
 */
export function asContextSource(canvas: GpuCanvas): ContextSource {
  return canvas;
}
