import type { GpuBackendName } from '../gpu/gpu-capabilities.js';
import type { FontLibrary } from '../text/font/font-library.js';
import type { FontFaceSource } from '../text/scene/text-pass-resources.js';

import type { EngineImageSupport } from './engine-extensions.js';
import type { EngineCanvas, EngineHostPlatform } from './engine-host-platform.js';
import type { EngineHost, EngineHostKind, EngineHostOptions } from './engine-host.js';
import type { EngineJobWorkers } from './engine-job-workers.js';
import type { EngineOverlayFactory } from './engine-overlay.js';
import { WorkerEngineHost, type EngineWorkerTransport } from './worker-engine-host.js';

/** Options for {@link createEngineHost}. */
export interface CreateEngineHostOptions extends EngineHostOptions {
  /** Where to run the engine when the browser allows both. Default `worker`. */
  readonly prefer?: EngineHostKind;
  /** The page's platform: `createBrowserHostPlatform(window)`. */
  readonly platform: EngineHostPlatform;
  /**
   * Starts an engine worker, whose script is
   * `serveWorkerEntry(self, createEngineWorkerEntry(createBrowserHostPlatform(self)))`. The
   * app owns the bundler and so the worker's URL:
   * `() => createWebWorkerTransport(new Worker(url, { type: 'module' }))`. Without it the engine
   * runs on the main thread.
   */
  readonly spawnWorker?: () => EngineWorkerTransport;
  /**
   * Creates the overlay layer when the engine runs on the main thread. A worker cannot receive a
   * function: its script passes its own to `createEngineWorkerEntry`.
   */
  readonly createOverlay?: EngineOverlayFactory;
  /**
   * Creates the text pass's fonts when the engine runs on the main thread; a worker's script
   * passes its own to `createEngineWorkerEntry`.
   */
  readonly createTextResources?: (fontFaces: readonly FontFaceSource[]) => FontLibrary;
  /**
   * The job workers the engine's pool starts when the engine runs on the main thread (path
   * meshes are built there). A worker cannot receive a function: the engine worker's script
   * passes its own to `createEngineWorkerEntry`. Without them, jobs run on the main thread after
   * each frame.
   */
  readonly jobWorkers?: EngineJobWorkers;
  /**
   * Creates the image support when the engine runs on the main thread, given
   * {@link CreateEngineHostOptions.imageChannel}; never called when it runs in a worker, whose
   * script's own `createImages` gets the channel instead, so the page opens no second asset
   * source (no second event stream per board, no second harness channel). The host closes it
   * when destroyed (`EngineImageSupport.close`). Without it images draw their placeholder.
   */
  readonly createImages?: (imageChannel: object | undefined) => EngineImageSupport;
  /**
   * An opaque transferable for the image support (the app's `MessagePort` to its assets, over
   * which the adapter asks for the board and the reader's token): transferred to the
   * engine worker with the canvas and handed to its script's `createImages`, or given to
   * {@link CreateEngineHostOptions.createImages} on the main thread. The engine never reads it.
   */
  readonly imageChannel?: object;
  /**
   * Called when the engine switches backend mid-session (to WebGL2 after a WebGPU
   * device loss, drawing on a fresh canvas laid over the page canvas), with the new backend.
   */
  readonly onBackendChanged?: (name: GpuBackendName) => void;
}

/** What the page can do towards running the engine in a worker. */
export interface EngineWorkerSupport {
  /** Whether a worker can render into a canvas transferred from the page. */
  readonly canRenderInWorker: boolean;
  /** Whether the caller can start an engine worker (it passed `spawnWorker`). */
  readonly canSpawnWorker: boolean;
}

/**
 * Chooses where the engine runs: in a worker when asked and possible, otherwise on the main
 * thread (`OffscreenCanvas` where available, main-thread fallback).
 *
 * @param prefer - Where the caller would like it.
 * @param support - What the page can do.
 * @returns `worker` only when preferred and supported.
 */
export function chooseEngineHostKind(
  prefer: EngineHostKind,
  support: EngineWorkerSupport,
): EngineHostKind {
  return prefer === 'worker' && support.canRenderInWorker && support.canSpawnWorker
    ? 'worker'
    : 'main';
}

/**
 * Spawns the worker and hands it the canvas, or gives up with the canvas untouched: spawning
 * comes first, so a worker that cannot start leaves the canvas to the main-thread fallback.
 *
 * @param canvas - The page canvas.
 * @param platform - The page's platform.
 * @param spawnWorker - Starts the worker.
 * @returns The worker and the transferred canvas, or `undefined` when either step failed.
 */
function handOverCanvas(
  canvas: EngineCanvas,
  platform: EngineHostPlatform,
  spawnWorker: () => EngineWorkerTransport,
): { transport: EngineWorkerTransport; offscreen: EngineCanvas } | undefined {
  let transport: EngineWorkerTransport;
  try {
    transport = spawnWorker();
  } catch {
    return undefined;
  }
  try {
    return { transport, offscreen: platform.transferControlToOffscreen(canvas) };
  } catch {
    transport.terminate();
    return undefined;
  }
}

/**
 * Starts the engine for a page canvas behind the {@link EngineHost} interface: in a dedicated
 * worker when `prefer` is `worker` (the default), the browser supports rendering there and a
 * worker can be spawned; on the main thread otherwise, including when spawning the worker or
 * handing over the canvas fails. Once the canvas is handed over it belongs to the worker, so a
 * failure after that (the worker script fails to load, no GPU backend in the worker) rejects
 * rather than falling back. Main thread.
 *
 * @param canvas - The page canvas, sized to its drawing buffer and holding no context yet.
 * @param options - Where to run, the platform, the worker spawner and the render options.
 * @returns The host, which draws once it has a camera.
 * @throws {Error} When no GPU backend can be created, or the worker fails after the hand-over.
 */
export async function createEngineHost(
  canvas: EngineCanvas,
  options: CreateEngineHostOptions,
): Promise<EngineHost> {
  const {
    prefer = 'worker',
    platform,
    spawnWorker,
    createOverlay,
    createTextResources,
    jobWorkers,
    createImages,
    imageChannel,
    onBackendChanged,
    ...hostOptions
  } = options;
  const kind = chooseEngineHostKind(prefer, {
    canRenderInWorker: platform.canRenderInWorker(),
    canSpawnWorker: spawnWorker !== undefined,
  });
  const handedOver =
    kind === 'worker' && spawnWorker !== undefined
      ? handOverCanvas(canvas, platform, spawnWorker)
      : undefined;
  if (handedOver !== undefined) {
    return WorkerEngineHost.create(
      handedOver.transport,
      handedOver.offscreen,
      platform.timeOriginMs,
      hostOptions,
      imageChannel,
      {
        pageCanvas: canvas,
        transferControlToOffscreen: (fallback) => platform.transferControlToOffscreen(fallback),
        ...(onBackendChanged === undefined ? {} : { onBackendChanged }),
      },
    );
  }
  const extensions = {
    ...(createOverlay === undefined ? {} : { createOverlay }),
    ...(createTextResources === undefined ? {} : { createTextResources }),
    ...(createImages === undefined ? {} : { images: createImages(imageChannel) }),
    ...(jobWorkers === undefined ? {} : { jobWorkers }),
  };
  // The engine on the page is the fallback for browsers whose worker cannot render: loaded only
  // when it is chosen, it stays out of the page's first script (the worker has its own).
  const { MainThreadEngineHost } = await import('./main-thread-engine-host.js');
  return MainThreadEngineHost.create(canvas, platform, hostOptions, extensions, onBackendChanged);
}
