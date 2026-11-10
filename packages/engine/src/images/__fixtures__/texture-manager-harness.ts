// Drives a TextureManager frame by frame over the fake backend, the fixture asset source and a
// job runner whose decode jobs run when the test settles them.
import type { ImageObject } from '@canvas/schema';

import { visibleWorldBounds, type Camera } from '../../camera/camera.js';
import { MemoryLedger } from '../../diagnostics/memory-ledger.js';
import type { DeviceMemoryBudget } from '../../memory/device-budget.js';
import { FakeGpuBackend } from '../../scene/__fixtures__/fake-gpu-backend.js';
import { AssetCatalogue } from '../asset-catalogue.js';
import type { AssetSource } from '../asset-source.js';
import type { ImageJobRunner } from '../level-loader.js';
import { RetrySchedule, type RetryTimer } from '../retry-schedule.js';
import type { ImageFrameResult } from '../texture-manager-options.js';
import { TextureManager } from '../texture-manager.js';

import { ManualJobRunner } from './manual-job-runner.js';

const MIB = 1024 * 1024;

/**
 * A budget whose `textures` share is `texturesBytes`.
 *
 * @param texturesBytes - The texture budget.
 * @param deviceClass - The device class; desktop by default.
 * @returns The budget.
 */
export function textureBudget(
  texturesBytes: number,
  deviceClass: DeviceMemoryBudget['deviceClass'] = 'desktop',
): DeviceMemoryBudget {
  return {
    deviceClass,
    totalBytes: texturesBytes + 4 * MIB,
    bytesByCategory: {
      instanceBuffers: MIB,
      atlases: MIB,
      textures: texturesBytes,
      meshes: MIB,
      uniforms: MIB,
      // The texture manager reads only its own share; offscreen layers get none.
      layers: 0,
    },
  };
}

/**
 * A 1000 × 800 CSS px camera at a zoom, looking from a world point.
 *
 * @param zoom - CSS px per world unit.
 * @param x - World x at the left edge.
 * @param y - World y at the top edge.
 * @param dpr - Device px per CSS px.
 * @returns The camera.
 */
export function cameraAt(zoom: number, x = 0, y = 0, dpr = 1): Camera {
  return { x, y, zoom, viewportWidthPx: 1000, viewportHeightPx: 800, dpr };
}

/** How a harness is set up; every field has a default. */
export interface HarnessSettings {
  readonly texturesBytes?: number;
  readonly maxTextureSize?: number;
  readonly maxCopyBytes?: number;
  readonly uploadBytesPerFrame?: number;
  /** Runs the decode jobs instead of the harness's `ManualJobRunner`. */
  readonly jobs?: ImageJobRunner;
  readonly onDecoderMissing?: (error: Error) => void;
  /** A mobile profile's budget (at most two GIFs play) instead of a desktop's. */
  readonly isMobile?: boolean;
}

/** A texture manager with its fakes, and a frame driver. */
export class TextureManagerHarness {
  backend: FakeGpuBackend;
  readonly jobs = new ManualJobRunner();
  readonly ledger = new MemoryLedger();
  readonly catalogue: AssetCatalogue;
  manager: TextureManager;
  private readonly settings: HarnessSettings;
  /** Frames requested since the last `frame`. */
  frameRequests = 0;
  /**
   * Retry waits (of loads and descriptions) started and neither run nor stopped: a test runs
   * them by hand.
   */
  readonly retries: (() => void)[] = [];
  /**
   * Starts a retry wait the test runs by hand; stopping it takes it out of `retries`.
   *
   * @param callback - What the wait runs.
   * @returns Stops the wait.
   */
  private readonly retryTimer: RetryTimer = (callback) => {
    this.retries.push(callback);
    return () => {
      const index = this.retries.indexOf(callback);
      if (index >= 0) this.retries.splice(index, 1);
    };
  };
  /**
   * Frame waits the GIF playback started, with their delays, ms: a test runs them by
   * hand, as the frame clock is the harness's.
   */
  readonly frameWaits: { readonly delayMs: number; readonly run: () => void }[] = [];
  private readonly frameTimer: RetryTimer = (callback, delayMs) => {
    const wait = { delayMs, run: callback };
    this.frameWaits.push(wait);
    return () => {
      const index = this.frameWaits.indexOf(wait);
      if (index >= 0) this.frameWaits.splice(index, 1);
    };
  };
  private frameIndex = 0;
  /** The time of the last frame, ms; the next `frame` is 16 ms later unless it says. */
  timeMs = 0;

  constructor(assets: AssetSource, settings: HarnessSettings = {}) {
    const maxTextureSize = settings.maxTextureSize ?? 8192;
    this.backend = new FakeGpuBackend({ maxTextureSize });
    this.catalogue = new AssetCatalogue(
      assets,
      maxTextureSize,
      settings.maxCopyBytes,
      new RetrySchedule(this.retryTimer),
    );
    this.settings = settings;
    this.manager = this.createManager();
  }

  /**
   * Replaces the backend and the manager, as the engine does after a device loss: the new
   * manager reads the same catalogue. Images must be tracked again.
   *
   * @param backend - The new backend.
   */
  rebuild(backend: FakeGpuBackend): void {
    this.manager.destroy();
    this.backend = backend;
    this.manager = this.createManager();
  }

  private createManager(): TextureManager {
    const { settings } = this;
    return new TextureManager({
      backend: this.backend,
      catalogue: this.catalogue,
      jobs: settings.jobs ?? this.jobs,
      ledger: this.ledger,
      budget: textureBudget(
        settings.texturesBytes ?? 256 * MIB,
        settings.isMobile === true ? 'mobile' : 'desktop',
      ),
      requestFrame: () => {
        this.frameRequests += 1;
      },
      retryTimer: this.retryTimer,
      frameTimer: this.frameTimer,
      ...(settings.uploadBytesPerFrame === undefined
        ? {}
        : { uploadBytesPerFrame: settings.uploadBytesPerFrame }),
      ...(settings.onDecoderMissing === undefined
        ? {}
        : { onDecoderMissing: settings.onDecoderMissing }),
    });
  }

  /**
   * Tracks image objects as the scene would when it prepares them.
   *
   * @param objects - The images, at the root (world transform = their own position).
   */
  track(...objects: readonly ImageObject[]): void {
    for (const object of objects) {
      this.manager.track({
        object,
        transform: {
          x: object.x,
          y: object.y,
          cos: Math.cos(object.rotation),
          sin: Math.sin(object.rotation),
        },
      });
    }
  }

  /**
   * Runs one frame's update, 16 ms after the last unless a time is given.
   *
   * @param camera - The frame's camera.
   * @param timeMs - The frame's time, ms.
   * @returns What the update did.
   */
  frame(camera: Camera, timeMs = this.timeMs + 16): ImageFrameResult {
    this.frameRequests = 0;
    this.timeMs = timeMs;
    const result = this.manager.update({
      camera,
      viewport: visibleWorldBounds(camera),
      frameIndex: this.frameIndex,
      timeMs: this.timeMs,
    });
    this.frameIndex += 1;
    return result;
  }

  /**
   * Runs frames and lets loads and jobs finish between them, until the manager is idle.
   *
   * @param camera - The camera of every frame.
   * @param maxFrames - A bound.
   * @returns The results, one per frame.
   */
  async settle(camera: Camera, maxFrames = 20): Promise<ImageFrameResult[]> {
    const results: ImageFrameResult[] = [];
    for (let index = 0; index < maxFrames; index += 1) {
      results.push(this.frame(camera));
      await this.jobs.settle();
      if (this.manager.isIdle && index > 0) {
        results.push(this.frame(camera));
        break;
      }
    }
    return results;
  }
}
