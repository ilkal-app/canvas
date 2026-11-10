import type { Camera, WorldBounds } from '../camera/camera.js';
import { DEFAULT_FRAME_HISTORY_CAPACITY } from '../diagnostics/frame-history.js';
import { FrameStatsRecorder } from '../diagnostics/frame-stats-recorder.js';
import { MemoryLedger } from '../diagnostics/memory-ledger.js';
import type { BenchmarkSample } from '../diagnostics/stats-export.js';
import type { GpuBackend, GpuDeviceLoss } from '../gpu/gpu-backend.js';
import { emptyFrameStats } from '../scene/frame-context.js';
import type { SceneRenderer } from '../scene/scene-renderer.js';

import { checkCanvasSize } from './canvas-size.js';
import { EngineAssembly } from './engine-assembly.js';
import type { EngineRuntimeExtensions } from './engine-extensions.js';
import { EngineFoundation } from './engine-foundation.js';
import type { EngineCanvas, FrameScheduler } from './engine-host-platform.js';
import type { EngineHostOptions } from './engine-host.js';
import type { EnginePixels, PixelRect } from './engine-pixels.js';
import type { EngineRuntimeCallbacks } from './engine-runtime-extensions.js';
import { answerFrameReads, toError, type PendingRead } from './frame-reads.js';
import type { InputMark } from './input-marks.js';
import type { PointerInput } from './pointer-input.js';
import { RuntimeCamera } from './runtime-camera.js';
import { drawingFrameFields } from './runtime-frame-fields.js';
import { RuntimeInputs } from './runtime-inputs.js';
import { RuntimeSceneReads } from './runtime-scene-reads.js';
import { RuntimeView } from './runtime-view.js';
import { SceneArrivals } from './scene-arrivals.js';
import { isSceneStamp, type SceneStamp } from './scene-certificate.js';
import type { PreviewRequest, PreviewCertificate } from './scene-certificate.js';
import type { SceneProjection } from './scene-projection.js';
import type { SerializableChangeSet } from './serializable-change-set.js';

/** Shared rendering-thread runtime: queued scene arrivals, camera, resources and frame reads. */
export class EngineRuntime {
  /** The GPU bytes every owner reports, shared with the frame timers. */
  readonly ledger = new MemoryLedger();
  private assembly: EngineAssembly;
  private readonly camera = new RuntimeCamera();
  private readonly inputs: RuntimeInputs;
  private readonly foundation: EngineFoundation;
  /** The per-viewer view settings: grid, theme, colour tokens (`RuntimeView`). */
  readonly view: RuntimeView;
  private readonly arrivals: SceneArrivals;
  private pendingReads: PendingRead[] = [];
  private readonly sceneReads = new RuntimeSceneReads();
  private frameHandle: number | undefined;
  private readonly frameStats: FrameStatsRecorder;
  private frameIndex = 0;
  private acknowledgementId = 0;
  private isRecovering = false;
  private isDestroyed = false;

  /**
   * Creates a runtime that draws on request.
   *
   * @param backend - The backend for `canvas`; the runtime owns it from now on.
   * @param canvas - The canvas the backend draws into.
   * @param scheduler - This thread's animation frames.
   * @param options - The clear colour (the backend options were used to create `backend`).
   * @param callbacks - Where frame reports and faults go.
   * @param extensions - Resources, overlay, job workers and backend recovery factories.
   * @param hasExclusiveRetainedPositions - Internal worker-entry capability for owned buffers.
   */
  constructor(
    backend: GpuBackend,
    private canvas: EngineCanvas,
    private readonly scheduler: FrameScheduler,
    private readonly options: EngineHostOptions,
    private readonly callbacks: EngineRuntimeCallbacks,
    private readonly extensions: EngineRuntimeExtensions = {},
    hasExclusiveRetainedPositions = false,
  ) {
    this.foundation = new EngineFoundation(backend, options, extensions, this.ledger, (error) => {
      if (!this.isDestroyed) this.callbacks.onFault(error);
    });
    this.arrivals = new SceneArrivals(hasExclusiveRetainedPositions, (stamp) => {
      this.sceneReads.previews.revisions.apply(stamp);
    });
    const live = (): EngineAssembly | undefined => (this.isDestroyed ? undefined : this.assembly);
    this.view = new RuntimeView(options, live, this.requestFrame.bind(this));
    this.assembly = this.assemble(backend);
    const now = (): number => scheduler.now();
    this.frameStats = new FrameStatsRecorder(this.renderer.frame, now, this.ledger);
    this.inputs = new RuntimeInputs(live, now, callbacks);
  }

  /**
   * The frame driver, replaced after device loss.
   *
   * @returns The current renderer.
   */
  get renderer(): SceneRenderer {
    return this.assembly.renderer;
  }

  /**
   * Queues a document change for the next frame's checked, mirrored apply stage.
   *
   * @param changes - The change, as received.
   * @param stamp - Optional contiguous mount revision.
   * @throws {RangeError} When the stamp is malformed.
   */
  applyChangeSet(changes: SerializableChangeSet, stamp?: SceneStamp): void {
    if (this.isDestroyed) return;
    if (stamp !== undefined && !isSceneStamp(stamp)) throw new RangeError('Invalid scene stamp.');
    this.arrivals.addChangeSet(changes, stamp);
    this.requestFrame();
  }

  /**
   * Queues the latest overlay model alongside the next frame's document changes.
   *
   * @param model - The model, as received.
   */
  setOverlay(model: unknown): void {
    if (!this.isDestroyed) this.arrivals.setOverlay(model);
    this.requestFrame();
  }

  /**
   * Draws with this camera from the next frame, stopping any animation.
   *
   * @param camera - The camera.
   */
  setCamera(camera: Camera): void {
    if (this.isDestroyed) return;
    this.camera.set({ ...camera });
    this.requestFrame();
  }

  /**
   * Animates from the current camera, or jumps when none exists.
   *
   * @param camera - Where the camera ends.
   * @param durationMs - How long the move takes, ms.
   */
  animateCamera(camera: Camera, durationMs: number): void {
    if (this.isDestroyed) return;
    this.camera.animate({ ...camera }, durationMs);
    this.requestFrame();
  }

  /**
   * Queues a pointer input for the next frame's report.
   *
   * @param input - The input.
   */
  pointer(input: PointerInput): void {
    if (!this.isDestroyed) this.inputs.pointer(input);
    this.requestFrame();
  }

  /**
   * Queues an input mark for the next frame, reported once the GPU finished it.
   *
   * @param mark - The mark, returned unchanged by `onInputsCompleted`.
   */
  markInput(mark: InputMark): void {
    if (!this.isDestroyed) this.inputs.mark(mark);
    this.requestFrame();
  }

  /**
   * How many input marks were dropped because their frame's GPU completion failed.
   *
   * @returns The count so far.
   */
  get droppedInputMarks(): number {
    return this.inputs.droppedMarks;
  }

  /**
   * Resizes the drawing buffer only when changed, and updates the camera viewport.
   *
   * @param widthPx - Drawing buffer width, device px.
   * @param heightPx - Drawing buffer height, device px.
   * @param dpr - Device pixels per CSS pixel.
   * @throws {RangeError} When the size is not positive whole pixels or the ratio not positive.
   */
  resize(widthPx: number, heightPx: number, dpr: number): void {
    checkCanvasSize(widthPx, heightPx, dpr);
    if (this.isDestroyed) return;
    if (this.canvas.width !== widthPx) this.canvas.width = widthPx;
    if (this.canvas.height !== heightPx) this.canvas.height = heightPx;
    this.camera.resize(widthPx, heightPx, dpr);
    this.requestFrame();
  }

  /** Asks for a frame, unless one is already coming (or the device is being rebuilt). */
  requestFrame(): void {
    if (this.isDestroyed || this.isRecovering || this.frameHandle !== undefined) return;
    this.frameHandle = this.scheduler.requestAnimationFrame((timeMs) => {
      this.runFrame(timeMs);
    });
  }

  /**
   * Requests a frame that includes this ordered host marker.
   *
   * @param id - Positive safe monotonic marker supplied by the host.
   */
  markFrameAcknowledgement(id: number): void {
    if (this.isDestroyed || !Number.isSafeInteger(id) || id <= this.acknowledgementId) return;
    this.acknowledgementId = id;
    this.requestFrame();
  }

  /**
   * Reads a rectangle of what the next frame draws, inside that frame.
   *
   * @param rect - The rectangle, device px.
   * @returns The pixels; rejects as `EngineHost.readPixels` describes.
   */
  readPixels(rect: PixelRect): Promise<EnginePixels> {
    if (this.isDestroyed) return Promise.reject(new Error('The engine was destroyed.'));
    return new Promise((resolve, reject) => {
      this.pendingReads.push({ rect, resolve, reject });
      this.requestFrame();
    });
  }

  /**
   * Starts a fresh statistics history and installs frame timers on this thread's clock.
   *
   * @param capacity - History size; default `DEFAULT_FRAME_HISTORY_CAPACITY` (240).
   * @throws {RangeError} When the capacity is not a positive integer.
   */
  startFrameStats(capacity: number = DEFAULT_FRAME_HISTORY_CAPACITY): void {
    if (!this.isDestroyed) this.frameStats.start(capacity);
  }

  /**
   * Summarises recorded frames.
   *
   * @returns Plain frame statistics.
   * @throws {Error} When statistics never started or the runtime was destroyed.
   */
  readFrameStats(): BenchmarkSample {
    if (this.isDestroyed) throw new Error('The engine was destroyed.');
    return this.frameStats.read();
  }

  /** Stops recording frame statistics and removes the stage timers; nothing when not running. */
  stopFrameStats(): void {
    this.frameStats.stop();
  }

  /**
   * Reads spatial candidates after the next frame has applied queued document changes.
   *
   * @param bounds - The preview coverage, in world units.
   * @returns Candidates and frame state, not a resource-readiness certificate.
   */
  readProjection(bounds: WorldBounds): Promise<SceneProjection | undefined> {
    if (this.isDestroyed) return Promise.reject(new Error('The engine is destroyed.'));
    const pending = this.sceneReads.projections.read(bounds);
    this.requestFrame();
    return pending;
  }

  /**
   * Queues a complete scene and resource certificate at the next drawn frame.
   *
   * @param request - Exact frame identity.
   * @returns Undefined until every required resource contributor is available.
   */
  readPreviewCertificate(request: PreviewRequest): Promise<PreviewCertificate | undefined> {
    if (this.isDestroyed) return Promise.reject(new Error('The engine was destroyed.'));
    const pending = this.sceneReads.previews.read(request);
    this.requestFrame();
    return pending;
  }

  /** Cancels the coming frame, rejects waiting reads, and frees the renderer and the backend. */
  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    if (this.frameHandle !== undefined) this.scheduler.cancelAnimationFrame(this.frameHandle);
    this.frameHandle = undefined;
    const destroyed = new Error('The engine was destroyed before the frame was drawn.');
    for (const read of this.pendingReads.splice(0)) read.reject(destroyed);
    this.sceneReads.reject(destroyed);
    this.assembly.destroy();
    this.foundation.destroy();
  }

  private assemble(backend: GpuBackend): EngineAssembly {
    const onFault = (error: Error): void => {
      this.callbacks.onFault(error);
    };
    return new EngineAssembly(backend, {
      options: this.options,
      extensions: this.extensions,
      passes: this.foundation.scenePasses(onFault),
      arrivals: this.arrivals,
      ...this.view.setup,
      onFault,
      onDeviceLost: (loss) => {
        void this.recover(loss);
      },
      requestFrame: () => {
        this.requestFrame();
      },
      now: () => this.scheduler.now(),
      environment: this.foundation.environment,
    });
  }

  /**
   * Rebuilds after device loss, replaying the scene and overlay and retargeting statistics.
   * Images restart at their smallest levels; without `recreateBackend` the loss is a fault.
   *
   * @param loss - The loss.
   */
  private async recover(loss: GpuDeviceLoss): Promise<void> {
    this.sceneReads.previews.reject(new Error(`The GPU device was lost: ${loss.message}`));
    const { recreateBackend } = this.extensions;
    if (this.isDestroyed) return;
    if (recreateBackend === undefined) {
      this.callbacks.onFault(new Error(`The GPU device was lost: ${loss.message}`));
      return;
    }
    this.isRecovering = true;
    if (this.frameHandle !== undefined) this.scheduler.cancelAnimationFrame(this.frameHandle);
    this.frameHandle = undefined;
    try {
      const lost = this.assembly.backend.capabilities.backendName;
      await loss.restored;
      const { backend, canvas } = await recreateBackend(loss, lost);
      if (!this.isAlive()) {
        backend.destroy();
        return;
      }
      this.canvas = canvas ?? this.canvas; // A switch after a WebGPU loss.
      this.assembly.destroy();
      this.foundation.adoptBackend(backend);
      this.assembly = this.assemble(backend);
      this.arrivals.replay(this.renderer);
      this.frameStats.retarget(this.renderer.frame);
    } catch (error) {
      this.callbacks.onFault(toError(error));
      return;
    } finally {
      this.isRecovering = false;
    }
    this.requestFrame();
  }

  private isAlive(): boolean {
    return !this.isDestroyed;
  }

  private runFrame(timeMs: number): void {
    const acknowledgementId = this.acknowledgementId;
    this.frameHandle = undefined;
    const reads = this.pendingReads.splice(0);
    const inputs = this.inputs.take();
    const revision = this.camera.revision;
    const isInvalid = (): boolean =>
      this.isDestroyed || this.arrivals.hasPendingChanges || revision !== this.camera.revision;
    let camera: Camera | undefined;
    let stats = emptyFrameStats();
    try {
      camera = this.camera.at(timeMs);
      if (camera !== undefined) stats = { ...this.renderer.renderFrame({ timeMs, camera }) };
      const size = { widthPx: this.canvas.width, heightPx: this.canvas.height };
      answerFrameReads(this.assembly.backend, size, reads, camera !== undefined);
      this.sceneReads.answer(this.renderer, camera, this.arrivals.hasPendingChanges, isInvalid);
    } catch (thrown) {
      const error = toError(thrown);
      this.camera.stop();
      // The frame's pointer inputs are not lost: the next frame reports them, before its own.
      this.inputs.restore(inputs);
      for (const read of reads) read.reject(error);
      this.sceneReads.reject(error);
      this.callbacks.onFault(error);
      return;
    }
    const frameIndex = this.frameIndex++;
    const hasPendingWork = this.renderer.hasPendingWork();
    this.callbacks.onFrame({
      frameIndex,
      ...(camera !== undefined && acknowledgementId > 0 && { acknowledgementId }),
      frameTimeMs: timeMs,
      camera,
      ...drawingFrameFields(this.canvas, this.renderer),
      stats,
      pointerInputs: inputs.pointerInputs,
      hasPendingWork,
      isImageIdle: this.foundation.isImageIdle,
      isUsingJobWorkers: this.foundation.jobs.isUsingWorkers,
    });
    this.inputs.complete({ frameIndex, frameTimeMs: timeMs, hasPendingWork }, inputs);
    // Drain local jobs after drawing so their results land before the next frame.
    const queuedJobs = this.foundation.jobs.runQueued(() => this.scheduler.now());
    // Path meshes still being built, and jobs still queued, draw on a later frame.
    const hasMoreWork = queuedJobs > 0 || this.renderer.hasPendingWork();
    if (this.camera.isAnimating || hasMoreWork) this.requestFrame();
  }
}
