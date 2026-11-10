import { attachEngineHarness } from '../harness/attach-engine-harness.js';
import { isCanvasHarnessEnabled } from '../harness/use-shell-harness.js';

import { createEngineHostMount } from './mount-engine-host.js';
import type { MountEngine } from './mounted-engine.js';
import { browserHostPlatform } from './start-browser-host.js';

/**
 * The engine host mount the shell uses with the engine in a given place. In harness builds
 * (`VITE_CANVAS_HARNESS=1`) it also puts the engine harness on the canvas, so scenario tests can
 * watch the default shell's frames; other builds drop that code.
 *
 * @param prefer - Where to run the engine.
 * @returns The mount.
 */
function hostMount(prefer: 'worker' | 'main'): MountEngine {
  return createEngineHostMount({
    prefer,
    ...(isCanvasHarnessEnabled ? { onEngineReady: attachEngineHarness } : {}),
  });
}

/** The engine in its worker. */
const mountWorkerEngine = hostMount('worker');

/** The engine on the page's main thread, behind the same host interface: the fallback. */
const mountMainThreadEngine = hostMount('main');

/**
 * Chooses the mount for a canvas: the engine host mount either way, with the engine in its
 * worker where a worker can render, else on the main thread (`MainThreadEngineHost`), which is
 * what `?engine=main` runs too, so the fallback path is the one the scenarios exercise.
 *
 * @param canRenderInWorker - Whether a worker can render into a canvas handed over from the page.
 * @returns The mount.
 */
export function chooseDefaultMount(canRenderInWorker: boolean): MountEngine {
  return canRenderInWorker ? mountWorkerEngine : mountMainThreadEngine;
}

/**
 * Creates a default `MountEngine` that asks where the engine can run on its first mount.
 *
 * @param canRenderInWorker - The probe; the harness page passes one that fails
 *   (`?workerProbe=fail`) to run the shell on its fallback.
 * @returns The mount.
 */
export function createDefaultMount(canRenderInWorker: () => boolean): MountEngine {
  return (canvas, options) => chooseDefaultMount(canRenderInWorker())(canvas, options);
}

/**
 * The shell's default `MountEngine`: the engine
 * host mount with the engine in its worker where the browser can render there (the platform's
 * `canRenderInWorker` probe: `OffscreenCanvas`, `transferControlToOffscreen`, `Worker` and an
 * `OffscreenCanvas` WebGL2 context), else with the engine on the main thread behind the same
 * `EngineHost` interface (Safari without `OffscreenCanvas` WebGL2). Should the worker still fail
 * to spawn or take the canvas, the host mount falls back to the main thread by itself. The probe
 * runs once per page, on the first mount. Main thread.
 */
export const mountDefaultEngine: MountEngine = createDefaultMount(() =>
  browserHostPlatform().canRenderInWorker(),
);
