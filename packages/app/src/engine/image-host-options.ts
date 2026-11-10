import type { EngineImageSupport } from '@canvas/engine';

import { directLinks, pagePortLink, type LinkPort } from '../assets/asset-channel.js';
import type { PageImages } from '../assets/page-images.js';

import { createImageSupport, createLinkedImageSupport } from './image-support.js';

/** The image options of `createEngineHost`, as the page gives them. */
export interface ImageHostOptions {
  /** The app's port, transferred to the engine worker (none without the page's images). */
  readonly imageChannel?: object;
  /** Creates the image support, for a main-thread host only. */
  readonly createImages: (imageChannel: object | undefined) => EngineImageSupport;
  /** Lets the page's images go back to the engine linked before, once this one is destroyed. */
  readonly release?: () => void;
}

/** The two ports of a `MessageChannel`. */
export interface ChannelPorts {
  /** The page's port. */
  readonly port1: LinkPort;
  /** The engine's port, transferred. */
  readonly port2: LinkPort;
}

/**
 * How the board and the reader's token reach the engine's asset adapter (the controller's
 * ruling for): the page makes a `MessageChannel`, keeps one port for its images
 * (`PageImages.connect`) and gives the other to `createEngineHost` as the opaque image channel,
 * which the host transfers to the engine worker with the canvas. A main-thread host is given the
 * page's end directly instead (`directLinks`), both ports closed. `release`, once the engine is
 * destroyed, gives the page's images back to the engine linked before (the live board's, under
 * a History preview). Without the page's images the engine gets the fallback support
 * (the harness's images, or none). Page.
 *
 * @param images - The page's images, or undefined.
 * @param createChannel - Makes the channel; `new MessageChannel()` by default.
 * @returns The options.
 */
export function imageHostOptions(
  images: PageImages | undefined,
  createChannel: () => ChannelPorts = () => new MessageChannel(),
): ImageHostOptions {
  if (images === undefined) return { createImages: () => createImageSupport() };
  const channel = createChannel();
  let release = images.connect(pagePortLink(channel.port1));
  return {
    imageChannel: channel.port2,
    createImages: () => {
      const links = directLinks();
      // The engine runs on this thread: the page's end is given directly, and the ports go.
      release();
      release = images.connect(links.page);
      channel.port2.close();
      return createLinkedImageSupport(links.adapter);
    },
    release: () => {
      release();
    },
  };
}

/**
 * The image options of an engine beside the page's own (an export's capture): always on
 * this thread, its link attached to the page's images (`PageImages.attach`) rather than replacing
 * the canvas engine's, and closed when the engine closes its support. Without the page's images,
 * the fallback support. Page.
 *
 * @param images - The page's images, or undefined.
 * @returns The options, for a main-thread host only.
 */
export function attachedImageHostOptions(images: PageImages | undefined): ImageHostOptions {
  if (images === undefined) return { createImages: () => createImageSupport() };
  return {
    createImages: () => {
      const links = directLinks();
      const detach = images.attach(links.page);
      const support = createLinkedImageSupport(links.adapter);
      return {
        ...support,
        close: () => {
          support.close?.();
          detach();
        },
      };
    },
  };
}
