import {
  createBrowserHostPlatform,
  createEngineHost,
  FRAME_FILL_LUMINANCE,
  type BrowserHostPlatform,
  type ChurnBudget,
  type EngineHost,
  type EngineHostKind,
  type GpuBackendName,
} from '@canvas/engine';

import type { PageImages } from '../assets/page-images.js';
import { harnessFramePlatform } from '../harness/harness-frames.js';
import { loadPageFonts, pageTextFonts, subscribePageFonts } from '../text-input/page-fonts.js';

import { describeDevice } from './device-description.js';
import { imageHostOptions, type ImageHostOptions } from './image-host-options.js';
import { createShellOverlay } from './shell-overlay.js';
import { spawnEngineWorker } from './spawn-engine-worker.js';
import { engineJobWorkers } from './spawn-job-worker.js';

/**
 * How long the engine may take to start (the worker to load and report its backend ready), ms;
 * a worker that never answers is then given up on, and the shell reports the failure.
 */
export const ENGINE_START_TIMEOUT_MS = 10_000;

let pagePlatform: BrowserHostPlatform | undefined;

/**
 * The page's engine host platform, created once, so the probe of whether a worker can render
 * (`canRenderInWorker`, which creates a 1 × 1 WebGL2 context and leaves it to the garbage
 * collector) runs once per page.
 *
 * @returns The platform for `window`.
 */
export function browserHostPlatform(): BrowserHostPlatform {
  if (pagePlatform === undefined) {
    const platform = createBrowserHostPlatform(window);
    pagePlatform =
      import.meta.env.VITE_CANVAS_HARNESS === '1' ? harnessFramePlatform(platform) : platform;
  }
  return pagePlatform;
}

/**
 * Settles with a starting host, or rejects once `timeoutMs` passes without it; a host that
 * starts after that is destroyed at once, so its worker does not linger.
 *
 * @param starting - The host being started.
 * @param timeoutMs - How long to wait, ms.
 * @returns The host, or a rejection with the start's error or the timeout.
 */
export function withStartTimeout(
  starting: Promise<EngineHost>,
  timeoutMs: number,
): Promise<EngineHost> {
  return new Promise((resolve, reject) => {
    let isTimedOut = false;
    const timer = setTimeout(() => {
      isTimedOut = true;
      reject(new Error(`The engine did not start within ${String(timeoutMs)} ms.`));
    }, timeoutMs);
    starting.then(
      (host) => {
        clearTimeout(timer);
        if (isTimedOut) host.destroy();
        else resolve(host);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Starts the engine host for the shell's canvas in the browser (`createEngineHost`): in the
 * engine worker where preferred and possible, else on the main thread, with the shell's
 * overlay layer (the selection overlay over the trace tint) and the page's font library for
 * the text pass (the engine worker is posted the
 * page's font files once they load: `spawnEngineWorker`), and a transparent clear, as the
 * main-thread mount clears, so the theme's canvas colour shows through. Gives up after
 * {@link ENGINE_START_TIMEOUT_MS}. The page's images reach the engine's asset adapter over an
 * app-owned port (`imageHostOptions`), released when the host is destroyed or fails to start.
 *
 * @param canvas - The canvas.
 * @param prefer - Where to run the engine.
 * @param engine - The engine's choices.
 * @param engine.backend - The GPU backend to try first; WebGPU if absent.
 * @param engine.churnBudget - The engine's per-frame churn budget; off if absent.
 * @param engine.imageOptions - The engine's image options in place of `imageHostOptions(images)`
 *   (an export's attached link).
 * @param engine.platform - The platform in place of the page's (`browserHostPlatform`): an
 *   export's, whose frames run as soon as asked.
 * @param images - The page's images (the board's assets and tokens); none if absent.
 * @returns The running host.
 */
export function startBrowserHost(
  canvas: HTMLCanvasElement,
  prefer: EngineHostKind,
  {
    backend,
    churnBudget,
    imageOptions,
    platform,
  }: {
    readonly backend?: GpuBackendName;
    readonly churnBudget?: ChurnBudget;
    readonly imageOptions?: ImageHostOptions;
    readonly platform?: BrowserHostPlatform;
  } = {},
  images?: PageImages,
): Promise<EngineHost> {
  // The page lays text out with the same files for the text tool (PAGE_TEXT_LAYOUT).
  loadPageFonts();
  const { release, ...image } = imageOptions ?? imageHostOptions(images);
  const starting = createEngineHost(canvas, {
    prefer,
    ...(backend === undefined ? {} : { backend }),
    ...(churnBudget === undefined ? {} : { churnBudget }),
    platform: platform ?? browserHostPlatform(),
    spawnWorker: spawnEngineWorker,
    createOverlay: createShellOverlay,
    // The main-thread host draws with the page's library; the engine worker is sent its files.
    createTextResources: pageTextFonts,
    // Used by the main-thread host; the engine worker's script starts its own.
    jobWorkers: engineJobWorkers(window),
    // The port to the page's images; `createImages` only for the main-thread host.
    ...image,
    device: describeDevice(window),
    clearColor: [0, 0, 0, 0],
    // Ink and tokens follow the nearest filled frame, as the snapshot service draws.
    colorModeFallback: FRAME_FILL_LUMINANCE,
  });
  return withStartTimeout(starting, ENGINE_START_TIMEOUT_MS).then(
    (host) => {
      const stop = subscribePageFonts(() => {
        host.requestFrame();
      });
      const destroy = host.destroy.bind(host);
      host.destroy = () => {
        stop();
        destroy();
        release?.(); // The images go back to the engine linked before.
      };
      return host;
    },
    (error: unknown) => {
      release?.();
      throw error;
    },
  );
}

let offscreenPlatform: BrowserHostPlatform | undefined;

/**
 * The platform of an engine that draws for a file rather than the screen (an export's capture,
 *): the page's, except that a frame runs as soon as it is asked for, in a task of its
 * own, not at the next display refresh: nothing waits for a refresh it is not part of, and a
 * scenario's frozen clock, which holds the page's frames until a read, does not hold it.
 *
 * @returns The platform, created once per page.
 */
export function offscreenHostPlatform(): BrowserHostPlatform {
  if (offscreenPlatform !== undefined) return offscreenPlatform;
  const platform = createBrowserHostPlatform(window);
  const pending = new Map<number, (timeMs: number) => void>();
  const channel = new MessageChannel();
  let nextHandle = 0;
  channel.port1.onmessage = (event: MessageEvent<number>) => {
    const callback = pending.get(event.data);
    pending.delete(event.data);
    callback?.(platform.now());
  };
  offscreenPlatform = {
    ...platform,
    requestAnimationFrame: (callback) => {
      nextHandle += 1;
      pending.set(nextHandle, callback);
      channel.port2.postMessage(nextHandle);
      return nextHandle;
    },
    cancelAnimationFrame: (handle) => {
      pending.delete(handle);
    },
  };
  return offscreenPlatform;
}
