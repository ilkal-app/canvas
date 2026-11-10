import { NO_IMAGE_ASSETS, type EngineImageSupport } from '@canvas/engine';

import { adapterPortLink, type AdapterLink, type LinkPort } from '../assets/asset-channel.js';
import { LinkedAssetSource } from '../assets/linked-asset-source.js';

import { createHarnessImageSupport } from './harness-assets.js';

/**
 * The image support the engine falls back on while the page has no assets service: seeded
 * synthetic images in harness builds (`createHarnessImageSupport`), else none (placeholders).
 *
 * @returns The support.
 */
function fallbackImageSupport(): EngineImageSupport {
  return import.meta.env.VITE_CANVAS_HARNESS === '1'
    ? createHarnessImageSupport()
    : { assets: NO_IMAGE_ASSETS };
}

/**
 * Whether the engine's opaque image channel is the app's `MessagePort`.
 *
 * @param channel - The channel `engine-init` carried.
 * @returns True for a port.
 */
function isLinkPort(channel: object | undefined): channel is LinkPort {
  return (
    channel !== undefined &&
    typeof (channel as Partial<LinkPort>).postMessage === 'function' &&
    typeof (channel as Partial<LinkPort>).close === 'function'
  );
}

/**
 * The app's image support over a link to the page: the engine's asset source asks the
 * page for the board's access over it and serves the assets service
 * (`LinkedAssetSource`), falling back on the harness's images, or none, while the page has no
 * assets service. The engine closes it when destroyed: the board's event streams end and the
 * link closes.
 *
 * @param link - The adapter's end of the link.
 * @param fallback - The support used without an assets service.
 * @returns The support.
 */
export function createLinkedImageSupport(
  link: AdapterLink,
  fallback: EngineImageSupport = fallbackImageSupport(),
): EngineImageSupport {
  const source = new LinkedAssetSource(link, { fallback: fallback.assets });
  return {
    assets: source,
    close: () => {
      source.close();
      fallback.close?.();
    },
  };
}

/**
 * What the engine needs from the app to draw images: the app's assets.
 * Given the app's `MessagePort` (the opaque channel the page transferred with `engine-init`,
 *), the assets service's adapter over it (`createLinkedImageSupport`); without one (a
 * page that mounts no board's images, such as the benchmark harness), the fallback: seeded
 * synthetic images in harness builds (`createHarnessImageSupport`), else none, so image objects
 * draw their placeholder. Images are decoded and resized by `decode` jobs in the engine's job
 * workers (`job-worker.ts`), never on the thread that renders, so no decode fallback is given.
 * Called on the thread the engine runs on only (the engine worker script's `createImages`), so
 * no second event stream or harness channel is opened; the engine closes it when destroyed.
 *
 * @param imageChannel - The page's port, or undefined.
 * @returns The image support.
 */
export function createImageSupport(imageChannel?: object): EngineImageSupport {
  const fallback = fallbackImageSupport();
  return isLinkPort(imageChannel)
    ? createLinkedImageSupport(adapterPortLink(imageChannel), fallback)
    : fallback;
}
