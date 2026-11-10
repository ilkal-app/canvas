/**
 * Tells whether a browser exposes WebGPU, the engine's first-choice backend; without it the
 * engine uses the WebGL2 backend. `navigator.gpu` is only the entry
 * test: requesting an adapter can still fail, and that also falls back to WebGL2.
 *
 * @param host - The navigator to inspect, normally `globalThis.navigator`.
 * @returns `true` when `host` exposes `navigator.gpu`.
 */
export function isWebGpuSupported(host: Navigator): boolean {
  return 'gpu' in host;
}
