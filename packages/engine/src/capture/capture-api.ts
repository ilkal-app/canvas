// The capture area's public API: exports drawn tile by tile, re-exported by the package
// entry, src/index.ts, which would otherwise pass 400 lines.
export {
  captureSizeOf,
  DEFAULT_CAPTURE_LIMITS,
  fitsCapture,
  planCapture,
  type CaptureLimits,
  type CapturePlan,
  type CaptureRect,
  type CaptureTile,
} from './capture-plan.js';
export { captureScene, type RenderCaptureTile } from './capture-scene.js';
