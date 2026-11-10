// What the engine host mount (mount-engine-host.ts) starts with, and its page helpers.
import type { EffectCallback } from 'react';

import { waitForStoreIdle, type DocumentStore } from '@canvas/document';
import type {
  Camera,
  ChurnBudget,
  EngineHost,
  EngineHostKind,
  GpuBackendName,
  InputMark,
} from '@canvas/engine';
import type { BoardObject } from '@canvas/schema';

import type { CanvasBackingSize } from '../canvas/backing-store-size.js';
import { whenPastesRead } from '../clipboard/pending-pastes.js';

import type { EnginePreviewScene } from './engine-preview-scene.js';
import type { HostView } from './host-view.js';

/** How the engine host mount starts its host and what it does once the host runs. */
export interface EngineHostMountOptions {
  /** Previously drawn inert scene; input waits for the live replacement frame. */
  readonly previewScene?: EnginePreviewScene;
  /** Where to run the engine: `worker` falls back to the main thread where it cannot run. */
  readonly prefer: EngineHostKind;
  /**
   * Called once the host runs, with the host, its canvas and a loader that writes board objects
   * into the mount's document (the select tool's; `EngineDocument.load`); may return a cleanup,
   * run when the canvas unmounts. Harness builds attach the engine harness here. The fourth
   * argument sends a benchmark's input mark after the mount's queued scene; the last
   * resolves once no stepped run holds the mount's board.
   */
  readonly onEngineReady?: (
    host: EngineHost,
    canvas: HTMLCanvasElement,
    loadDocument: (objects: readonly BoardObject[]) => void,
    markInput: (mark: InputMark) => void,
    whenStoreIdle: () => Promise<void>,
  ) => ReturnType<EffectCallback>;
  /** The GPU backend to try first (the other is the fallback); WebGPU if absent. */
  readonly backend?: GpuBackendName;
  /** The engine's per-frame churn budget (`EngineHostOptions.churnBudget`); off if absent. */
  readonly churnBudget?: ChurnBudget;
  /**
   * Starts the host; `startBrowserHost` (the browser platform, the engine worker, the selection
   * overlay layer, a start timeout) by default.
   */
  readonly startHost?: (canvas: HTMLCanvasElement, prefer: EngineHostKind) => Promise<EngineHost>;
}

/**
 * Calls the mount's `onEngineReady`, with a loader that sends what it wrote at once, and a mark
 * sender that goes through the mount's view, so a mark follows the scene queued before it.
 *
 * @param options - The mount's options.
 * @param host - The running host.
 * @param canvas - Its canvas.
 * @param view - The mount's frame-coalesced view of the host.
 * @param loadDocument - Writes board objects into the mount's document; the view flushes after.
 * @param store - The mount's board, which a stepped run holds; idle at once when absent.
 * @returns The cleanup `onEngineReady` returned, if any.
 */
export function announceEngine(
  options: EngineHostMountOptions,
  host: EngineHost,
  canvas: HTMLCanvasElement,
  view: HostView,
  loadDocument: (objects: readonly BoardObject[]) => void,
  store?: DocumentStore,
): ReturnType<EffectCallback> {
  const load = (objects: readonly BoardObject[]): void => {
    loadDocument(objects);
    view.flush();
  };
  const mark = (input: InputMark): void => {
    view.markInput(input);
  };
  const whenIdle = async (): Promise<void> => {
    // A large paste is read in stages before its run holds the board.
    await whenPastesRead();
    if (store !== undefined) await waitForStoreIdle(store);
  };
  return options.onEngineReady?.(host, canvas, load, mark, whenIdle);
}

/**
 * Whether the person asked for reduced motion (`prefers-reduced-motion`).
 *
 * @returns True when they did.
 */
export function prefersReducedMotionQuery(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Reports an engine fault to the page as an uncaught error would be.
 *
 * @param error - The fault.
 */
export function reportFault(error: Error): void {
  reportError(error);
}

/**
 * The canvas's size as it is laid out now.
 *
 * @param canvas - The canvas.
 * @returns Its CSS and drawing buffer size and the device pixel ratio.
 */
export function measureViewport(canvas: HTMLCanvasElement): CanvasBackingSize {
  return {
    cssWidthPx: canvas.clientWidth,
    cssHeightPx: canvas.clientHeight,
    widthPx: canvas.width,
    heightPx: canvas.height,
    dpr: window.devicePixelRatio,
  };
}

/**
 * The camera a mount starts with before anything places it: the board's origin at 100% on a
 * viewport of the canvas's size (at least 1 × 1 CSS px). Pure.
 *
 * @param viewport - The canvas's size and pixel ratio.
 * @returns The camera.
 */
export function startingCamera(viewport: CanvasBackingSize): Camera {
  return {
    x: 0,
    y: 0,
    zoom: 1,
    viewportWidthPx: Math.max(1, viewport.cssWidthPx),
    viewportHeightPx: Math.max(1, viewport.cssHeightPx),
    dpr: viewport.dpr,
  };
}
