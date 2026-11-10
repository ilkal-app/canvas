// The GPU area's public API (the backend interface, its resources and passes, render targets and
// the layer composite), re-exported by the package entry, src/index.ts, which would otherwise
// pass 400 lines.
export { createGpuBackend } from './create-gpu-backend.js';
export type { CreateGpuBackendOptions } from './create-gpu-backend.js';
export type {
  GpuBackend,
  GpuDeviceLoss,
  GpuDeviceLostListener,
  GpuPassTiming,
} from './gpu-backend.js';
export type { GpuBindGroup, GpuBindGroupDescriptor, GpuBindGroupEntry } from './gpu-bind-group.js';
export type { GpuBuffer, GpuBufferDescriptor, GpuBufferUsage } from './gpu-buffer.js';
export type { GpuCanvas } from './gpu-canvas.js';
export type { GpuDrawStateCounts } from './gpu-draw-state-counts.js';
export type { GpuBackendName, GpuCapabilities, GpuSampleCount } from './gpu-capabilities.js';
export type {
  GpuBindingLayoutEntry,
  GpuBlendMode,
  GpuColorWrite,
  GpuCompareFunction,
  GpuRenderPipeline,
  GpuRenderPipelineDescriptor,
  GpuStencilOperation,
  GpuStencilState,
} from './gpu-pipeline.js';
export type {
  GpuColor,
  GpuRenderPass,
  GpuRenderPassDescriptor,
  GpuViewport,
} from './gpu-render-pass.js';
export type { GpuRenderTarget, GpuRenderTargetDescriptor } from './gpu-render-target.js';
export type { GpuShaderSource } from './gpu-shader.js';
export { createLayerCompositePipeline, drawLayerComposite } from './layer-composite-pass.js';
export { CURVE_STENCIL_SHADER } from './shaders/curve-stencil.generated.js';
export { GLYPH_STENCIL_MOVE_SHADER } from './shaders/glyph-stencil-move.generated.js';
export { GLYPH_STENCIL_SHADER } from './shaders/glyph-stencil.generated.js';
export { PARITY_TRIANGLE_SHADER } from './shaders/parity-triangle.generated.js';
export type {
  GpuAddressMode,
  GpuFilterMode,
  GpuSampler,
  GpuSamplerDescriptor,
  GpuTexture,
  GpuTextureDataLayout,
  GpuTextureDescriptor,
  GpuTextureFormat,
  GpuTextureRegion,
} from './gpu-texture.js';
export type {
  GpuVertexAttribute,
  GpuVertexBufferLayout,
  GpuVertexFormat,
  GpuVertexStepMode,
} from './vertex-layout.js';
export { isWebGpuSupported } from './webgpu-support.js';
