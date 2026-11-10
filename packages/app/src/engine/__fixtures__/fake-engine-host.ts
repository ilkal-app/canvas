// A stand-in engine host for the engine host mount's tests (mount-engine-host*.test.ts): it
// records what the mount asks of it and emits frames and faults when told, and a helper that
// mounts on it. The real hosts are tested in @canvas/engine and, in Chrome, by the scenarios.
import { expect, vi } from 'vitest';

import type {
  BenchmarkSample,
  Camera,
  ColorTokenValues,
  EngineFaultListener,
  EngineFrameListener,
  EngineHost,
  PixelRect,
  PointerInput,
  SerializableChangeSet,
} from '@canvas/engine';
import type { BoardObject } from '@canvas/schema';
import type { SelectionOverlayModel } from '@canvas/tools';

import type { CanvasBackingSize } from '../../canvas/backing-store-size.js';
import { createEngineHostMount } from '../mount-engine-host.js';
import type { MountedEngine, MountEngineOptions } from '../mounted-engine.js';

/** The canvas the tests mount on: 400 × 200 at a ratio of 1. */
export const VIEWPORT: CanvasBackingSize = {
  cssWidthPx: 400,
  cssHeightPx: 200,
  widthPx: 400,
  heightPx: 200,
  dpr: 1,
};

/** The demo board's first rectangle: world (50, 50), 70 × 60, at (10, 10) in its section. */
export const MARKER = 'section-0-rect-0-0';

/** A host stand-in: records what the mount asks of it and emits frames when told. */
export class FakeHost {
  readonly kind = 'worker';
  readonly calls: [string, ...unknown[]][] = [];
  readonly changeSets: SerializableChangeSet[] = [];
  readonly overlays: SelectionOverlayModel[] = [];
  /** Every `setGridVisible` argument, in order. */
  readonly gridStates: boolean[] = [];
  /** Every `setTheme` theme, in order. */
  readonly themes: ('light' | 'dark')[] = [];
  /** Every `setColorTokens` table, in order. */
  readonly colorTokens: ColorTokenValues[] = [];
  readonly inputs: PointerInput[] = [];
  readonly listeners = new Set<EngineFrameListener>();
  readonly faultListeners = new Set<EngineFaultListener>();
  sample: BenchmarkSample | undefined;
  /** The camera the last `animateCamera` aimed for. */
  animatedTo: Camera | undefined;
  isDestroyed = false;

  applyChangeSet(changes: SerializableChangeSet): void {
    this.changeSets.push(changes);
    this.calls.push(['applyChangeSet', changes.created.length]);
  }

  setOverlay(model: SelectionOverlayModel): void {
    this.overlays.push(model);
  }

  setGridVisible(isVisible: boolean): void {
    this.gridStates.push(isVisible);
  }

  setTheme(theme: 'light' | 'dark'): void {
    this.themes.push(theme);
  }

  setColorTokens(tokens: ColorTokenValues): void {
    this.colorTokens.push(tokens);
  }

  setCamera(camera: Camera): void {
    this.calls.push(['setCamera', camera.zoom]);
  }

  animateCamera(camera: Camera, durationMs: number): void {
    this.animatedTo = camera;
    this.calls.push(['animateCamera', camera.zoom, durationMs]);
  }

  resize(widthPx: number, heightPx: number, dpr: number): void {
    this.calls.push(['resize', widthPx, heightPx, dpr]);
  }

  pointer(input: PointerInput): void {
    this.inputs.push(input);
  }

  readPixels(rect: PixelRect): Promise<{ widthPx: number; heightPx: number; rgba: Uint8Array }> {
    // One half-covered red pixel, premultiplied.
    const rgba = new Uint8Array(rect.widthPx * rect.heightPx * 4);
    rgba.set([64, 0, 0, 128]);
    return Promise.resolve({ widthPx: rect.widthPx, heightPx: rect.heightPx, rgba });
  }

  startFrameStats(): void {
    this.calls.push(['startFrameStats']);
  }

  readFrameStats(): Promise<BenchmarkSample> {
    return this.sample === undefined
      ? Promise.reject(new Error('not started'))
      : Promise.resolve(this.sample);
  }

  stopFrameStats(): void {
    this.calls.push(['stopFrameStats']);
  }

  onFrame(listener: EngineFrameListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onFault(listener: EngineFaultListener): () => void {
    this.faultListeners.add(listener);
    return () => this.faultListeners.delete(listener);
  }

  emitFrame(camera?: Camera, drawingBuffer = { widthPx: 400, heightPx: 200 }): void {
    for (const listener of [...this.listeners]) {
      listener({
        frameIndex: 0,
        frameTimeMs: 0,
        camera,
        drawingBuffer,
        stats: {
          changedObjects: 0,
          bufferWrites: 0,
          uploadedBytes: 0,
          drawCalls: 0,
          blankImages: 0,
          placeholderImages: 0,
          visibleImages: 0,
          segments: 0,
          carriedAdmissions: 0,
          lodTransitions: 0,
          lodThrashes: 0,
          atlasRegenerations: 0,
          atlasLookups: 0,
          atlasMisses: 0,
          meshRegenerations: 0,
          vectorTextRuns: 0,
          layersDrawn: 0,
          layersFallbackSmall: 0,
          layersFallbackLimit: 0,
          layersFallbackBudget: 0,
          layerBytes: 0,
          renderPasses: 0,
          pipelineSwitches: 0,
          bindGroupChanges: 0,
        },
        pointerInputs: [],
        hasPendingWork: false,
        isUsingJobWorkers: false,
      });
    }
  }

  emitFault(error: Error): void {
    for (const listener of [...this.faultListeners]) listener(error);
  }

  destroy(): void {
    this.isDestroyed = true;
  }
}

function sizedCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = VIEWPORT.widthPx;
  canvas.height = VIEWPORT.heightPx;
  Object.assign(canvas, { setPointerCapture: () => undefined });
  document.body.append(canvas);
  return canvas;
}

/** How {@link mountOnFakeHost} mounts. */
export interface MountOptions {
  readonly isReducedMotion?: boolean;
  readonly isViewportGiven?: boolean;
  readonly options?: MountEngineOptions;
  /** Runs after the mount is created and before its host starts. */
  readonly beforeStart?: (engine: MountedEngine) => void;
}

/** The camera the mount starts with, as the host's first frame reports it. */
export const START_CAMERA: Camera = {
  x: 0,
  y: 0,
  zoom: 1,
  viewportWidthPx: 400,
  viewportHeightPx: 200,
  dpr: 1,
};

/**
 * Mounts the engine host mount on a fake host and waits for it to be ready.
 *
 * @param mountOptions - Reduced motion, whether the shell gives a size, mount options, and what
 *   to do before the host starts.
 * @returns The host, the engine, the canvas, the ready callback's cleanup, a pointer event
 *   dispatcher (primary button, canvas px) and the document loaders the ready callback got.
 */
export async function mountOnFakeHost(mountOptions: MountOptions = {}) {
  const { isReducedMotion = false, isViewportGiven = true, options = {} } = mountOptions;
  vi.stubGlobal('matchMedia', () => ({ matches: isReducedMotion }));
  const host = new FakeHost();
  const cleanupReady = vi.fn();
  const loaders: ((objects: readonly BoardObject[]) => void)[] = [];
  let startHost: (value: EngineHost) => void = () => undefined;
  const mount = createEngineHostMount({
    prefer: 'worker',
    startHost: () =>
      new Promise((resolve) => {
        startHost = resolve;
      }),
    onEngineReady: (readyHost, readyCanvas, loadDocument) => {
      loaders.push(loadDocument);
      return cleanupReady;
    },
  });
  const canvas = sizedCanvas();
  const engine = mount(canvas, isViewportGiven ? { viewport: VIEWPORT, ...options } : options);
  mountOptions.beforeStart?.(engine);
  startHost(host as unknown as EngineHost);
  await vi.waitFor(() => {
    expect(host.listeners.size).toBeGreaterThan(1);
  });
  host.emitFrame(START_CAMERA);
  await engine.ready;
  const pointer = (type: string, x: number, y: number) =>
    canvas.dispatchEvent(
      new PointerEvent(type, { pointerId: 1, button: 0, clientX: x, clientY: y }),
    );
  return { host, engine, canvas, cleanupReady, pointer, loaders };
}
