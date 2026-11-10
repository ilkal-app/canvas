// Test doubles for the engine host: a platform whose animation frames run only when a test says
// so, a canvas, and a fake GPU backend that reads back an image of the canvas's size.
import type { CreateGpuBackendOptions } from '../../gpu/create-gpu-backend.js';
import { FakeGpuBackend } from '../../scene/__fixtures__/fake-gpu-backend.js';
import type { EngineCanvas, EngineHostPlatform } from '../engine-host-platform.js';

/** A canvas stand-in: its drawing buffer size, and whether its control was handed over. */
export class FakeCanvas implements EngineCanvas {
  width: number;
  height: number;
  isTransferred = false;

  /**
   * Creates a canvas.
   *
   * @param width - Drawing buffer width, device px.
   * @param height - Drawing buffer height, device px.
   */
  constructor(width = 4, height = 2) {
    this.width = width;
    this.height = height;
  }
}

/**
 * A fake backend whose `readPixels` returns the canvas's size of pixels, each pixel's red
 * channel its index modulo 256, and records calls and `destroy`.
 */
export class ReadableFakeGpuBackend extends FakeGpuBackend {
  /** `readPixels` calls so far. */
  readCount = 0;
  /** Whether `destroy` was called. */
  isDestroyed = false;
  /** When set, the next `readPixels` rejects with it. */
  readFailure: Error | undefined;
  /** When set, the next `submit` throws it, failing that frame. */
  submitFailure: Error | undefined;
  private readonly canvas: EngineCanvas;

  /**
   * Creates the backend.
   *
   * @param canvas - The canvas it reads back.
   */
  constructor(canvas: EngineCanvas) {
    super();
    this.canvas = canvas;
  }

  override readPixels(): Promise<Uint8Array<ArrayBuffer>> {
    this.readCount += 1;
    const failure = this.readFailure;
    this.readFailure = undefined;
    if (failure !== undefined) return Promise.reject(failure);
    const pixelCount = this.canvas.width * this.canvas.height;
    const pixels = new Uint8Array(pixelCount * 4);
    for (let index = 0; index < pixelCount; index += 1) pixels[index * 4] = index % 256;
    return Promise.resolve(pixels);
  }

  override submit(): void {
    const failure = this.submitFailure;
    this.submitFailure = undefined;
    if (failure !== undefined) throw failure;
    super.submit();
  }

  override destroy(): void {
    super.destroy();
    this.isDestroyed = true;
  }
}

/**
 * A platform whose animation frames run when the test calls {@link FakeHostPlatform.runFrame},
 * and whose backends are {@link ReadableFakeGpuBackend}s.
 */
export class FakeHostPlatform implements EngineHostPlatform {
  readonly timeOriginMs: number;
  /** Every backend created, in order. */
  readonly backends: ReadableFakeGpuBackend[] = [];
  /** The options of every `createBackend` call. */
  readonly backendOptions: CreateGpuBackendOptions[] = [];
  /** What `canRenderInWorker` answers. */
  isWorkerRenderingSupported = true;
  /** What the platform says of its scope's animation frames; unset says nothing. */
  hasAnimationFrames?: boolean;
  /** When set, `createBackend` rejects with it. */
  backendFailure: Error | undefined;
  /** What `now` returns next, ms. */
  clockMs = 0;
  /** How far each `now` call advances the clock, ms; 0 keeps it still. */
  clockStepMs = 0;
  private readonly callbacks = new Map<number, (timeMs: number) => void>();
  private nextHandle = 1;

  /**
   * Creates a platform.
   *
   * @param timeOriginMs - This thread's clock origin, ms since the epoch.
   */
  constructor(timeOriginMs = 1_000_000) {
    this.timeOriginMs = timeOriginMs;
  }

  /**
   * The number of frame callbacks waiting.
   *
   * @returns The count.
   */
  get pendingFrames(): number {
    return this.callbacks.size;
  }

  now(): number {
    const timeMs = this.clockMs;
    this.clockMs += this.clockStepMs;
    return timeMs;
  }

  requestAnimationFrame(callback: (timeMs: number) => void): number {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.callbacks.set(handle, callback);
    return handle;
  }

  cancelAnimationFrame(handle: number): void {
    this.callbacks.delete(handle);
  }

  createBackend(
    canvas: EngineCanvas,
    options: CreateGpuBackendOptions,
  ): Promise<ReadableFakeGpuBackend> {
    this.backendOptions.push(options);
    if (this.backendFailure !== undefined) return Promise.reject(this.backendFailure);
    const backend = new ReadableFakeGpuBackend(canvas);
    this.backends.push(backend);
    return Promise.resolve(backend);
  }

  canRenderInWorker(): boolean {
    return this.isWorkerRenderingSupported;
  }

  transferControlToOffscreen(canvas: EngineCanvas): EngineCanvas {
    if (!(canvas instanceof FakeCanvas) || canvas.isTransferred) {
      throw new Error('This canvas cannot hand over control.');
    }
    canvas.isTransferred = true;
    return new FakeCanvas(canvas.width, canvas.height);
  }

  /**
   * Runs every waiting frame callback, as the browser does before presenting a frame.
   *
   * @param timeMs - The frame's timestamp, ms on this platform's clock.
   */
  runFrame(timeMs: number): void {
    const due = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of due) callback(timeMs);
  }
}
