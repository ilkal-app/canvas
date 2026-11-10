import type { GpuCanvas } from '../gpu-canvas.js';
import { asContextSource } from '../gpu-canvas.js';
import type { GpuSampleCount } from '../gpu-capabilities.js';
import { isWebGpuSupported } from '../webgpu-support.js';

import { WebGpuBackend } from './webgpu-backend.js';
import { WebGpuCanvasTarget } from './webgpu-canvas-target.js';
import { resolveWebGpuCapabilities } from './webgpu-capabilities.js';
import { WebGpuPassTimer } from './webgpu-pass-timer.js';

/**
 * Creates the WebGPU backend: adapter, then device (with `timestamp-query` when the adapter has
 * it), then the canvas context. The canvas is claimed last, so a failure before it leaves the
 * canvas free for the WebGL2 fallback.
 *
 * @param canvas - The canvas to draw into.
 * @param sampleCount - 4 for 4× MSAA, 1 for none.
 * @returns The backend, or `undefined` when the browser has no WebGPU or no adapter.
 * @throws {Error} When the device is created but the canvas offers no `webgpu` context.
 */
export async function createWebGpuBackend(
  canvas: GpuCanvas,
  sampleCount: GpuSampleCount,
): Promise<WebGpuBackend | undefined> {
  if (!isWebGpuSupported(navigator)) {
    return undefined;
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) {
    return undefined;
  }
  const hasTimestamps = adapter.features.has('timestamp-query');
  const device = await adapter.requestDevice({
    requiredFeatures: hasTimestamps ? ['timestamp-query'] : [],
  });
  const context = asContextSource(canvas).getContext('webgpu');
  if (!context) {
    device.destroy();
    throw new Error('The canvas offers no webgpu context.');
  }
  const target = new WebGpuCanvasTarget(
    device,
    context,
    navigator.gpu.getPreferredCanvasFormat(),
    sampleCount,
  );
  const capabilities = resolveWebGpuCapabilities({
    maxTextureDimension2D: device.limits.maxTextureDimension2D,
    features: new Set(device.features),
    info: adapter.info,
    sampleCount,
  });
  return new WebGpuBackend(
    device,
    target,
    new WebGpuPassTimer(device, hasTimestamps),
    capabilities,
  );
}
