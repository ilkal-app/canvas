/** Renderer-name fragments of the software rasterizers browsers fall back to. */
const SOFTWARE_RENDERER_PATTERN =
  /swiftshader|llvmpipe|softpipe|lavapipe|microsoft basic render|\bwarp\b/i;

/**
 * Tells whether an adapter or renderer description names a software rasterizer, on which
 * rendering output is never judged (software GPUs garble SDF edges).
 *
 * @param adapterName - The WebGPU adapter description or the WebGL unmasked renderer string.
 * @returns `true` when the name matches a known software rasterizer.
 */
export function isSoftwareAdapterName(adapterName: string): boolean {
  return SOFTWARE_RENDERER_PATTERN.test(adapterName);
}
