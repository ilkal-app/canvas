import type { InkTheme } from '@canvas/schema';

import type { Camera, WorldBounds } from '../camera/camera.js';
import { DEFAULT_FRAME_HISTORY_CAPACITY } from '../diagnostics/frame-history.js';
import type { BenchmarkSample } from '../diagnostics/stats-export.js';
import type { GpuCapabilities } from '../gpu/gpu-capabilities.js';
import type { ColorTokenValues, InkColors } from '../paint/color-palette.js';
import type { StickyAuthors } from '../text/scene/sticky-author-box.js';

import { serializeColorTokens } from './color-token-messages.js';
import { EngineHostEvents } from './engine-host-events.js';
import type { EngineCanvas } from './engine-host-platform.js';
import type {
  EngineFaultListener,
  EngineFrameListener,
  EngineHost,
  EngineHostOptions,
  EngineTransferTimings,
} from './engine-host.js';
import type { EnginePixels, PixelRect } from './engine-pixels.js';
import { startWorker, type WorkerReady } from './engine-worker-start.js';
import type { EngineWorkerTransport } from './engine-worker-transport.js';
import { FrameAcknowledgements } from './frame-acknowledgements.js';
import {
  toHostError,
  type EngineCommand,
  type EngineInitMessage,
  type WorkerToHostMessage,
} from './host-protocol.js';
import type { EngineInputsCompletedListener, InputMark } from './input-marks.js';
import { overlayLayerOf } from './layered-overlay.js';
import { PageTickAnswers } from './page-frame-ticks.js';
import type { PointerInput } from './pointer-input.js';
import { copyPreviewRequest, isPreviewRequest, isSceneStamp } from './scene-certificate.js';
import type { SceneStamp, PreviewRequest, PreviewCertificate } from './scene-certificate.js';
import { isProjectionBounds, type SceneProjection } from './scene-projection.js';
import type { SerializableChangeSet } from './serializable-change-set.js';
import { serializeStickyAuthors } from './sticky-author-messages.js';
import { transferTimings, type EngineTransferStamps } from './transfer-stamps.js';
import { WorkerCanvasSwitch, type WorkerCanvasFallback } from './worker-canvas-fallback.js';
import { WorkerReads } from './worker-reads.js';

export type { EngineWorkerTransport } from './engine-worker-transport.js';
/**
 * The page's clock, ms (`performance.now()`), typed here because the engine core compiles
 * without DOM types.
 *
 * @returns The time now.
 */
function pageNow(): number {
  return (globalThis as unknown as { performance: { now(): number } }).performance.now();
}

/**
 * The engine in a dedicated worker, drawing into the page canvas's `OffscreenCanvas`: the page
 * keeps only this proxy, so React and the document store cannot delay a frame. Calls made in one
 * task are posted together as one message at the end of the task, so they land in one frame; frame
 * reports come back with their times converted to the page's clock.
 */
export class WorkerEngineHost implements EngineHost {
  /** Always `worker`. */
  readonly kind = 'worker';
  /** The backend the worker draws with: `webgl2` after a switch. */
  capabilities: GpuCapabilities;
  private readonly transport: EngineWorkerTransport;
  private readonly canvasSwitch: WorkerCanvasSwitch;
  private readonly clockOffsetMs: number;
  private readonly events = new EngineHostEvents();
  private readonly acknowledgements = new FrameAcknowledgements();
  private readonly reads = new WorkerReads();
  private commands: EngineCommand[] = [];
  private isDestroyed = false;
  /** Ticks for a worker without animation frames, at the page's own. */
  private readonly frameTicks = new PageTickAnswers(() => {
    if (!this.isDestroyed) this.transport.post({ type: 'engine-frame-tick' }, []);
  });
  private isTimingTransfers = false;
  private offsetErrors = 0;

  private constructor(
    transport: EngineWorkerTransport,
    ready: WorkerReady,
    canvasFallback: WorkerCanvasFallback | undefined,
  ) {
    this.transport = transport;
    this.canvasSwitch = new WorkerCanvasSwitch(canvasFallback);
    this.capabilities = ready.capabilities;
    this.clockOffsetMs = ready.clockOffsetMs;
  }

  /**
   * Starts the engine in a spawned worker on a canvas whose control the page has handed over.
   *
   * @param transport - The spawned engine worker, not yet connected.
   * @param canvas - The `OffscreenCanvas` from `transferControlToOffscreen`; transferred.
   * @param pageTimeOriginMs - The page's `performance.timeOrigin`, ms since the epoch.
   * @param options - Backend, sample count and clear colour.
   * @param imageChannel - An opaque transferable for the worker script's `createImages` (the
   *   app's `MessagePort` to its assets); transferred; none if absent.
   * @param canvasFallback - How to give the worker a fresh canvas after a WebGPU loss; without
   *   it such a loss is reported as a fault.
   * @returns The host once the worker's backend exists.
   * @throws {Error} When the worker fails to load or cannot create a backend; the worker is
   *   terminated, and the page canvas stays handed over, so no main-thread fallback is possible.
   */
  static async create(
    transport: EngineWorkerTransport,
    canvas: EngineCanvas,
    pageTimeOriginMs: number,
    options: EngineHostOptions = {},
    imageChannel?: object,
    canvasFallback?: WorkerCanvasFallback,
  ): Promise<WorkerEngineHost> {
    // Messages after `engine-ready` go to the host, which exists once the promise settles.
    const started: { host?: WorkerEngineHost } = {};
    const init: EngineInitMessage = {
      type: 'engine-init',
      canvas,
      options,
      ...(imageChannel === undefined ? {} : { imageChannel }),
    };
    const ready = await startWorker(
      transport,
      init,
      pageTimeOriginMs,
      (message) => started.host?.receive(message),
      (error) => started.host?.fail(error),
    );
    started.host = new WorkerEngineHost(transport, ready, canvasFallback);
    return started.host;
  }

  applyChangeSet(changes: SerializableChangeSet, stamp?: SceneStamp): void {
    if (this.isDestroyed) return;
    if (stamp !== undefined && !isSceneStamp(stamp)) throw new RangeError('Invalid scene stamp.');
    this.enqueue({
      type: 'change-set',
      changes,
      ...(stamp === undefined ? {} : { stamp: { ...stamp } }),
    });
  }

  setOverlay(model: unknown): void {
    // One overlay per layer per batch: a newer model replaces the older one for the same layer
    // where it stood, and leaves other layers' models be (a peer's box and the person's
    // drag overlay in one batch both reach the worker).
    const layer = overlayLayerOf(model);
    const index = this.commands.findIndex(
      (command) => command.type === 'overlay' && overlayLayerOf(command.model) === layer,
    );
    if (index === -1) this.enqueue({ type: 'overlay', model });
    else this.commands[index] = { type: 'overlay', model };
  }

  setGridVisible(isVisible: boolean): void {
    this.enqueue({ type: 'grid', isVisible });
  }

  setTheme(theme: InkTheme, inkColors?: InkColors): void {
    this.enqueue({ type: 'theme', theme, ...(inkColors && { inkColors }) });
  }

  setColorTokens(tokens: ColorTokenValues): void {
    this.enqueue({ type: 'tokens', tokens: serializeColorTokens(tokens) });
  }

  setStickyAuthors(authors: StickyAuthors): void {
    this.enqueue({ type: 'stickyAuthors', ...serializeStickyAuthors(authors) });
  }

  setCamera(camera: Camera): void {
    this.enqueue({ type: 'camera', camera });
  }

  animateCamera(camera: Camera, durationMs: number): void {
    this.enqueue({ type: 'animate-camera', camera, durationMs });
  }

  pointer(input: PointerInput): void {
    this.enqueue({ type: 'pointer', input });
  }

  resize(widthPx: number, heightPx: number, dpr: number): void {
    this.canvasSwitch.resize(widthPx, heightPx, dpr);
    this.enqueue({ type: 'resize', widthPx, heightPx, dpr });
  }

  loseDeviceForTesting(): void {
    this.enqueue({ type: 'lose-device' });
  }

  requestFrameAcknowledgement(): Promise<number> {
    return this.acknowledgements.request((id) => {
      this.enqueue({ type: 'acknowledge-frame', id });
    });
  }

  requestFrame(): void {
    this.enqueue({ type: 'request-frame' });
  }

  markInput(mark: InputMark): void {
    this.enqueue({ type: 'mark-input', mark });
  }

  /**
   * How many frame reports carried a negative transfer leg: the two clocks disagree.
   *
   * @returns The count so far.
   */
  get transferOffsetErrors(): number {
    return this.offsetErrors;
  }

  readPixels(rect: PixelRect): Promise<EnginePixels> {
    if (this.isDestroyed) return Promise.reject(new Error('The engine was destroyed.'));
    return this.reads.open('pixels', (id) => {
      this.enqueue({ type: 'read-pixels', id, rect });
    });
  }

  readPreviewCertificate(request: PreviewRequest): Promise<PreviewCertificate | undefined> {
    if (!isPreviewRequest(request))
      return Promise.reject(new RangeError('Invalid preview request.'));
    if (this.isDestroyed) return Promise.reject(new Error('The engine was destroyed.'));
    const owned = copyPreviewRequest(request);
    return this.reads.open('certificate', (id) => {
      this.enqueue({ type: 'read-preview-certificate', id, request: owned });
    });
  }

  readProjection(bounds: WorldBounds): Promise<SceneProjection | undefined> {
    if (!isProjectionBounds(bounds))
      return Promise.reject(new RangeError('Projection bounds must be finite and ordered.'));
    if (this.isDestroyed) return Promise.reject(new Error('The engine was destroyed.'));
    return this.reads.open('projection', (id) => {
      this.enqueue({ type: 'read-projection', id, bounds: { ...bounds } });
    });
  }

  startFrameStats(capacity: number = DEFAULT_FRAME_HISTORY_CAPACITY): void {
    this.isTimingTransfers = true;
    this.enqueue({ type: 'start-frame-stats', capacity });
  }

  stopFrameStats(): void {
    this.isTimingTransfers = false;
    this.enqueue({ type: 'stop-frame-stats' });
  }

  readFrameStats(): Promise<BenchmarkSample> {
    if (this.isDestroyed) return Promise.reject(new Error('The engine was destroyed.'));
    return this.reads.open('stats', (id) => {
      this.enqueue({ type: 'read-frame-stats', id });
    });
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
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.acknowledgements.destroy();
    this.commands = [];
    this.reads.rejectAll(new Error('The engine was destroyed before the frame was drawn.'));
    this.transport.terminate();
    this.canvasSwitch.destroy();
  }

  private enqueue(command: EngineCommand): void {
    if (this.isDestroyed) return;
    this.commands.push(command);
    // The first call of a task schedules the flush; the rest of the task joins its batch.
    if (this.commands.length === 1) {
      void Promise.resolve().then(() => {
        this.flush();
      });
    }
  }

  private flush(): void {
    const commands = this.commands;
    this.commands = [];
    if (this.isDestroyed || commands.length === 0) return;
    try {
      const postedMs = this.isTimingTransfers ? pageNow() : undefined;
      this.transport.post(
        { type: 'engine-commands', commands, ...(postedMs !== undefined && { postedMs }) },
        [],
      );
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      for (const command of commands) {
        if (
          command.type === 'read-pixels' ||
          command.type === 'read-frame-stats' ||
          command.type === 'read-projection' ||
          command.type === 'read-preview-certificate'
        ) {
          this.reads.settle(command.id, failure);
        }
      }
      this.reportFault(failure);
    }
  }

  private receive(message: WorkerToHostMessage | undefined): void {
    if (this.isDestroyed) return;
    if (message === undefined) {
      this.reportFault(new TypeError('The engine worker sent a malformed message.'));
      return;
    }
    switch (message.type) {
      case 'engine-frame': {
        const { report } = message;
        this.acknowledgements.acknowledge(report);
        const transferMs = this.transferTimings(message.transfer);
        this.events.emitFrame({
          ...report,
          frameTimeMs: report.frameTimeMs + this.clockOffsetMs,
          ...(transferMs && { transferMs }),
        });
        return;
      }
      case 'engine-inputs-completed': {
        const { completion } = message;
        this.events.emitInputsCompleted({
          ...completion,
          frameTimeMs: completion.frameTimeMs + this.clockOffsetMs,
          completedMs: completion.completedMs + this.clockOffsetMs,
        });
        return;
      }
      case 'engine-preview-certificate':
        this.reads.settle(message.id, { kind: 'certificate', value: message.certificate });
        return;
      case 'engine-projection':
        this.reads.settle(message.id, { kind: 'projection', value: message.projection });
        return;
      case 'engine-pixels':
        this.reads.settle(message.id, { kind: 'pixels', value: message.pixels });
        return;
      case 'engine-frame-stats':
        this.reads.settle(message.id, { kind: 'stats', value: message.sample });
        return;
      case 'engine-failure':
        if (message.id === undefined) this.reportFault(toHostError(message.failure));
        else this.reads.settle(message.id, toHostError(message.failure));
        return;
      case 'engine-needs-canvas':
        this.canvasSwitch.handOver(this.transport, this.reportFault.bind(this));
        return;
      case 'engine-needs-frame-tick':
        this.frameTicks.ask();
        return;
      case 'engine-backend-changed':
        this.capabilities = message.capabilities;
        this.canvasSwitch.backendChanged(message.capabilities.backendName);
        return;
      case 'engine-ready':
        this.reportFault(new Error('The engine worker reported ready twice.'));
    }
  }

  private transferTimings(
    stamps: EngineTransferStamps | undefined,
  ): EngineTransferTimings | undefined {
    if (stamps === undefined) return undefined;
    const timings = transferTimings(stamps, this.clockOffsetMs, pageNow());
    if (timings === undefined) this.offsetErrors += 1;
    return timings;
  }

  private reportFault(error: Error): void {
    this.acknowledgements.reject(error);
    this.events.emitFault(error);
  }

  private fail(error: Error): void {
    if (this.isDestroyed) return;
    this.reads.rejectAll(error);
    this.reportFault(error);
  }
}
