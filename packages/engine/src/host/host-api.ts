// The engine host area's public API (the engine in a worker or on the main thread, its protocol
// and platforms), re-exported by the package entry, src/index.ts, which would otherwise pass 400
// lines.
export { createEngineHost } from './create-engine-host.js';
export type { EngineJobWorkers } from './engine-job-workers.js';
export type { CreateEngineHostOptions } from './create-engine-host.js';
export type {
  EngineFaultListener,
  EngineFrameListener,
  EngineFrameReport,
  EngineHost,
  EngineHostKind,
  EngineDeviceOptions,
  EngineHostOptions,
  EngineTransferTimings,
} from './engine-host.js';
export { INPUT_MARK_KINDS, isEngineInputsCompleted, isInputMark } from './input-marks.js';
export type {
  EngineInputsCompleted,
  EngineInputsCompletedListener,
  InputMark,
  InputMarkKind,
} from './input-marks.js';
export type {
  EngineCanvas,
  EngineHostPlatform,
  EngineThreadPlatform,
  FrameScheduler,
} from './engine-host-platform.js';
export type { EnginePixels, PixelRect, PixelSize } from './engine-pixels.js';
export type {
  EngineCommand,
  EngineCommandsMessage,
  EngineFallbackCanvasMessage,
  EngineFrameTickMessage,
  EngineInitMessage,
  HostFailure,
  HostToWorkerMessage,
  WorkerToHostMessage,
} from './host-protocol.js';
export type {
  EngineExtensions,
  EngineImageSupport,
  EngineRuntimeExtensions,
  RecreateBackend,
  RecreatedBackend,
} from './engine-extensions.js';
export type { EngineOverlay, EngineOverlayFactory } from './engine-overlay.js';
export { layerOverlays, overlayLayerModel } from './layered-overlay.js';
export type { OverlayLayerModel } from './layered-overlay.js';
export { createEngineWorkerEntry } from './engine-worker-entry.js';
export type {
  EngineWorkerEntry,
  EngineWorkerExtensions,
  EngineWorkerPoster,
} from './engine-worker-entry.js';
export { MainThreadEngineHost } from './main-thread-engine-host.js';
export type { PointerInput, PointerInputType } from './pointer-input.js';
export { deserializeColorTokens, serializeColorTokens } from './color-token-messages.js';
export { deserializeStickyAuthors, serializeStickyAuthors } from './sticky-author-messages.js';
export type { SerializableStickyAuthors } from './sticky-author-messages.js';
export type { SerializableColorToken } from './color-token-messages.js';
export { serializeChangeSet } from './serializable-change-set.js';
export type { SerializableChangeSet } from './serializable-change-set.js';
export { createBrowserHostPlatform } from './web/browser-host-platform.js';
export type {
  BrowserHostClock,
  BrowserHostPlatform,
  BrowserHostScope,
  SizedCanvas,
} from './web/browser-host-platform.js';
export type { EngineTransferStamps } from './transfer-stamps.js';
export { WorkerEngineHost } from './worker-engine-host.js';
export type { EngineWorkerTransport } from './worker-engine-host.js';
export type { WorkerCanvasFallback } from './worker-canvas-fallback.js';

export type { SceneProjection } from './scene-projection.js';

export type {
  SceneStamp,
  PreviewRequest,
  PreviewCertificate,
  PreviewAssetVersion,
} from './scene-certificate.js';

export { isPreviewCertificate } from './scene-certificate.js';
