import type { InkTheme } from '@canvas/schema';

import type { Camera, WorldBounds } from '../camera/camera.js';
import type { BenchmarkSample } from '../diagnostics/stats-export.js';
import type { GpuBackend } from '../gpu/gpu-backend.js';
import type { GpuBackendName, GpuCapabilities } from '../gpu/gpu-capabilities.js';
import type { ColorTokenValues, InkColors } from '../paint/color-palette.js';
import type { StickyAuthors } from '../text/scene/sticky-author-box.js';

import { backendOptionsOf } from './backend-options.js';
import { switchingBackendFactory } from './backend-switch.js';
import type { EngineExtensions, EngineRuntimeExtensions } from './engine-extensions.js';
import { EngineHostEvents } from './engine-host-events.js';
import type { EngineCanvas, EngineThreadPlatform } from './engine-host-platform.js';
import type {
  EngineFaultListener,
  EngineFrameListener,
  EngineFrameReport,
  EngineHost,
  EngineHostOptions,
} from './engine-host.js';
import type { EnginePixels, PixelRect } from './engine-pixels.js';
import { EngineRuntime } from './engine-runtime.js';
import {
  overlayFallbackCanvas,
  removeFallbackCanvas,
  sizeFallbackCanvas,
} from './fallback-canvas.js';
import { FrameAcknowledgements } from './frame-acknowledgements.js';
import type { EngineInputsCompletedListener, InputMark } from './input-marks.js';
import type { PointerInput } from './pointer-input.js';
import type { SceneStamp, PreviewRequest, PreviewCertificate } from './scene-certificate.js';
import type { SceneProjection } from './scene-projection.js';
import type { SerializableChangeSet } from './serializable-change-set.js';

/**
 * The engine on the page's main thread, drawing into the page canvas: the fallback where no
 * worker can render (Safari falls back to it behind the same interface), and the control case
 * of the jank benchmark. Frames run on the page's animation frames, so main-thread work delays
 * them.
 */
export class MainThreadEngineHost implements EngineHost {
  /** Always `main`. */
  readonly kind = 'main';
  private readonly runtime: EngineRuntime;
  /** The backend the engine draws with: rebuilt after a device loss. */
  private backend: GpuBackend;
  /** The fallback canvas after a switch to WebGL2, sized with every resize. */
  private fallback: EngineCanvas | undefined;
  private readonly events = new EngineHostEvents();
  private readonly acknowledgements = new FrameAcknowledgements();

  private constructor(
    backend: GpuBackend,
    private readonly canvas: EngineCanvas,
    platform: EngineThreadPlatform,
    options: EngineHostOptions,
    extensions: EngineRuntimeExtensions,
  ) {
    this.backend = backend;
    const callbacks = {
      onFrame: (report: EngineFrameReport) => {
        this.acknowledgements.acknowledge(report);
        this.events.emitFrame(report);
      },
      onFault: (error: Error) => {
        this.acknowledgements.reject(error);
        this.events.emitFault(error);
      },
      onInputsCompleted: this.events.emitInputsCompleted.bind(this.events),
    };
    this.runtime = new EngineRuntime(backend, canvas, platform, options, callbacks, extensions);
  }

  /**
   * Creates the backend for the page canvas and the engine around it.
   *
   * @param canvas - The page canvas, sized by the page.
   * @param platform - The page's platform (`createBrowserHostPlatform(window)`).
   * @param options - Backend, sample count and clear colour.
   * @param extensions - Creates the overlay layer and the text resources, the image support, and
   *   the job workers the engine's pool starts from the page (without them, jobs run on the main
   *   thread after each frame), if any.
   * @param onBackendChanged - Called when the engine switches backend mid-session.
   * @returns The host, which has not drawn yet.
   * @throws {Error} When no GPU backend can be created for the canvas.
   */
  static async create(
    canvas: EngineCanvas,
    platform: EngineThreadPlatform,
    options: EngineHostOptions = {},
    extensions: EngineExtensions = {},
    onBackendChanged?: (name: GpuBackendName) => void,
  ): Promise<MainThreadEngineHost> {
    const backendOptions = backendOptionsOf(options);
    const backend = await platform.createBackend(canvas, backendOptions);
    // After a WebGPU loss the engine draws on a fresh canvas laid over the page canvas.
    const recreateBackend = switchingBackendFactory(
      platform,
      canvas,
      backendOptions,
      () => {
        host.fallback = overlayFallbackCanvas(canvas);
        return host.fallback;
      },
      (rebuilt, isSwitch) => {
        host.backend = rebuilt;
        if (isSwitch) onBackendChanged?.(rebuilt.capabilities.backendName);
      },
    );
    const runtimeExtensions = { ...extensions, recreateBackend };
    const host: MainThreadEngineHost = new MainThreadEngineHost(
      backend,
      canvas,
      platform,
      options,
      runtimeExtensions,
    );
    return host;
  }

  /**
   * The backend the engine draws with now.
   *
   * @returns Its capabilities: `webgl2` after a switch.
   */
  get capabilities(): GpuCapabilities {
    return this.backend.capabilities;
  }

  loseDeviceForTesting(): void {
    this.backend.loseDeviceForTesting?.();
  }

  applyChangeSet(changes: SerializableChangeSet, stamp?: SceneStamp): void {
    this.runtime.applyChangeSet(changes, stamp);
  }

  setOverlay(model: unknown): void {
    this.runtime.setOverlay(model);
  }

  setGridVisible(isVisible: boolean): void {
    this.runtime.view.setGridVisible(isVisible);
  }

  setTheme(theme: InkTheme, inkColors?: InkColors): void {
    this.runtime.view.setTheme(theme, inkColors);
  }

  setColorTokens(tokens: ColorTokenValues): void {
    this.runtime.view.setColorTokens(tokens);
  }

  setStickyAuthors(authors: StickyAuthors): void {
    this.runtime.view.setStickyAuthors(authors);
  }

  setCamera(camera: Camera): void {
    this.runtime.setCamera(camera);
  }

  animateCamera(camera: Camera, durationMs: number): void {
    this.runtime.animateCamera(camera, durationMs);
  }

  pointer(input: PointerInput): void {
    this.runtime.pointer(input);
  }

  resize(widthPx: number, heightPx: number, dpr: number): void {
    this.runtime.resize(widthPx, heightPx, dpr);
    if (this.fallback !== undefined) sizeFallbackCanvas(this.fallback, widthPx, heightPx, dpr);
  }

  requestFrameAcknowledgement(): Promise<number> {
    return this.acknowledgements.request((id) => {
      this.runtime.markFrameAcknowledgement(id);
    });
  }

  requestFrame(): void {
    this.runtime.requestFrame();
  }

  markInput(mark: InputMark): void {
    this.runtime.markInput(mark);
  }

  readPixels(rect: PixelRect): Promise<EnginePixels> {
    return this.runtime.readPixels(rect);
  }

  readPreviewCertificate(request: PreviewRequest): Promise<PreviewCertificate | undefined> {
    return this.runtime.readPreviewCertificate(request);
  }

  readProjection(bounds: WorldBounds): Promise<SceneProjection | undefined> {
    return this.runtime.readProjection(bounds);
  }

  startFrameStats(capacity?: number): void {
    this.runtime.startFrameStats(capacity);
  }

  readFrameStats(): Promise<BenchmarkSample> {
    try {
      return Promise.resolve(this.runtime.readFrameStats());
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  stopFrameStats(): void {
    this.runtime.stopFrameStats();
  }

  onFrame(listener: EngineFrameListener): () => void {
    return this.events.onFrame(listener);
  }

  onFault(listener: EngineFaultListener): () => void {
    return this.events.onFault(listener);
  }

  onInputsCompleted(listener: EngineInputsCompletedListener): () => void {
    return this.events.onInputsCompleted(listener);
  }

  destroy(): void {
    this.acknowledgements.destroy();
    this.runtime.destroy();
    if (this.fallback !== undefined) removeFallbackCanvas(this.canvas, this.fallback);
    this.fallback = undefined;
  }
}
