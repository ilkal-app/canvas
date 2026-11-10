import { ASSET_STATUSES, type AssetId, type AssetStatus } from '@canvas/schema';

import type { AssetAccess } from './assets-http.js';
import type { ImagePixelSize } from './prepare-image.js';

/** An image the page holds before (and while) it uploads: the engine draws it from these bytes. */
export interface LocalImage {
  /** The asset: the SHA-256 of the file. */
  readonly assetId: AssetId;
  /** The file's media type. */
  readonly mimeType: string;
  /** Its upright size, px. */
  readonly naturalSize: ImagePixelSize;
  /** The file: a `Blob` crosses to the engine worker without copying its bytes. */
  readonly file: Blob;
}

/**
 * What the page sends the engine's asset adapter over the app's `MessagePort` (the controller's
 * ruling for: an app-owned port transferred to the engine worker at start, never a
 * `BroadcastChannel`, which any same-origin page could hear): the board's access (the assets
 * service, the board and the reader's token; `null` for a page with no assets service), a
 * board's switch or a token's refresh being a new `access`; a local image to draw at once; an
 * upload that verified, so the adapter describes it from the service and reports its status; and
 * the page's visibility, which pauses the adapter's polls while the page is hidden.
 */
export type PageAssetMessage =
  | {
      /** The board's access, at start, on a token refresh and on a board switch. */
      readonly type: 'access';
      /** The access, or null without an assets service. */
      readonly access: AssetAccess | null;
    }
  | {
      /** An image the page is uploading, to draw from its own bytes meanwhile. */
      readonly type: 'local-image';
      /** The image. */
      readonly image: LocalImage;
    }
  | {
      /** The page's upload of an asset verified: follow it and report its status. */
      readonly type: 'uploaded';
      /** The asset. */
      readonly assetId: AssetId;
    }
  | {
      /** The page dropped its upload of a local image (its objects removed): let its bytes go. */
      readonly type: 'forget-local';
      /** The asset. */
      readonly assetId: AssetId;
    }
  | {
      /** The page was hidden or shown: the adapter's polls pause while it is hidden. */
      readonly type: 'page-visibility';
      /** Whether the page is hidden. */
      readonly isHidden: boolean;
    }
  | {
      /**
       * The board's session ended: the adapter makes no request from now on, keeps what
       * it holds and asks the page for nothing.
       */
      readonly type: 'session-ended';
    };

/** What the engine's asset adapter sends the page. */
export type AdapterAssetMessage =
  | {
      /** The adapter needs the access: at start, or because the token expired. */
      readonly type: 'access-request';
    }
  | {
      /**
       * The adapter holds a local image: the page may create its objects, which the engine then
       * draws from the page's bytes without asking the service first.
       */
      readonly type: 'local-image-held';
      /** The image's asset. */
      readonly assetId: AssetId;
    }
  | {
      /** Where an asset the page uploaded stands, for its badge (after `uploaded`). */
      readonly type: 'asset-status';
      /** The asset. */
      readonly assetId: AssetId;
      /** Its status. */
      readonly status: AssetStatus;
      /** Its pyramid's progress, 0 to 1. */
      readonly progress: number;
    }
  | {
      /**
       * The assets of a collaborator's images on screen still processing, sent when
       * they change: their spinners.
       */
      readonly type: 'processing';
      /** The assets, sorted. */
      readonly assetIds: readonly AssetId[];
    };

/** One end of a two-way link, whatever carries it. */
export interface AssetLink<Out, In> {
  /**
   * Sends a message to the other end.
   *
   * @param message - The message.
   */
  send(message: Out): void;
  /**
   * Receives the other end's messages.
   *
   * @param listener - Called with each one, in order.
   * @returns Stops listening.
   */
  listen(listener: (message: In) => void): () => void;
  /** Stops the link; nothing is sent or received after. */
  close(): void;
}

/** The adapter's end: sends to the page, hears the page. */
export type AdapterLink = AssetLink<AdapterAssetMessage, PageAssetMessage>;

/** The page's end: sends to the adapter, hears the adapter. */
export type PageLink = AssetLink<PageAssetMessage, AdapterAssetMessage>;

/** The part of a `MessagePort` a link uses. */
export interface LinkPort {
  /** Receives messages. */
  onmessage: ((event: MessageEvent) => void) | null;
  /**
   * Sends a message.
   *
   * @param message - The message.
   */
  postMessage(message: unknown): void;
  /** Closes the port. */
  close(): void;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isString = (value: unknown): value is string => typeof value === 'string';

/**
 * Whether a received value is well-formed access, or null.
 *
 * @param value - The value.
 * @returns True for `null` or `{ assetsUrl, boardId, token }` strings.
 */
function isAccess(value: unknown): boolean {
  return (
    value === null ||
    (isObject(value) &&
      isString(value.assetsUrl) &&
      isString(value.boardId) &&
      isString(value.token))
  );
}

/**
 * Whether a message crossing to the adapter is well formed (a port's messages are untrusted).
 *
 * @param value - The message.
 * @returns True for a {@link PageAssetMessage}.
 */
export function isPageAssetMessage(value: unknown): value is PageAssetMessage {
  if (!isObject(value)) return false;
  if (value.type === 'access') return isAccess(value.access);
  if (value.type === 'uploaded' || value.type === 'forget-local') return isString(value.assetId);
  if (value.type === 'page-visibility') return typeof value.isHidden === 'boolean';
  if (value.type === 'session-ended') return true;
  if (value.type !== 'local-image' || !isObject(value.image)) return false;
  const { assetId, mimeType, naturalSize, file } = value.image;
  return (
    isString(assetId) &&
    isString(mimeType) &&
    isObject(naturalSize) &&
    typeof naturalSize.width === 'number' &&
    typeof naturalSize.height === 'number' &&
    file instanceof Blob
  );
}

/**
 * Whether a message crossing to the page is well formed.
 *
 * @param value - The message.
 * @returns True for an {@link AdapterAssetMessage}.
 */
export function isAdapterAssetMessage(value: unknown): value is AdapterAssetMessage {
  if (!isObject(value)) return false;
  if (value.type === 'access-request') return true;
  if (value.type === 'local-image-held') return isString(value.assetId);
  if (value.type === 'processing') {
    return Array.isArray(value.assetIds) && value.assetIds.every(isString);
  }
  return (
    value.type === 'asset-status' &&
    isString(value.assetId) &&
    (ASSET_STATUSES as readonly unknown[]).includes(value.status) &&
    typeof value.progress === 'number'
  );
}

/**
 * One end of a link over a `MessagePort`, dropping malformed messages.
 *
 * @param port - The port.
 * @param isIncoming - Checks a received message.
 * @returns The link end.
 */
function portLink<Out, In>(
  port: LinkPort,
  isIncoming: (value: unknown) => value is In,
): AssetLink<Out, In> {
  const listeners = new Set<(message: In) => void>();
  port.onmessage = (event) => {
    const data: unknown = event.data;
    if (!isIncoming(data)) return;
    for (const listener of listeners) listener(data);
  };
  return {
    send: (message) => {
      port.postMessage(message);
    },
    listen: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: () => {
      listeners.clear();
      port.onmessage = null;
      port.close();
    },
  };
}

/**
 * The adapter's end over the engine worker's port (the channel `engine-init` transferred).
 *
 * @param port - The worker's port.
 * @returns The adapter's link.
 */
export function adapterPortLink(port: LinkPort): AdapterLink {
  return portLink(port, isPageAssetMessage);
}

/**
 * The page's end over its port.
 *
 * @param port - The page's port.
 * @returns The page's link.
 */
export function pagePortLink(port: LinkPort): PageLink {
  return portLink(port, isAdapterAssetMessage);
}

/**
 * Both ends in one thread, without a port (the main-thread engine host is given the page's end
 * directly): each message is delivered in a later microtask, as a port would.
 *
 * @returns The page's and the adapter's ends.
 */
export function directLinks(): { readonly page: PageLink; readonly adapter: AdapterLink } {
  const toAdapter = new Set<(message: PageAssetMessage) => void>();
  const toPage = new Set<(message: AdapterAssetMessage) => void>();
  let isClosed = false;
  const deliver = <M>(listeners: Set<(message: M) => void>, message: M) => {
    queueMicrotask(() => {
      if (isClosed) return;
      for (const listener of listeners) listener(message);
    });
  };
  const close = () => {
    isClosed = true;
    toAdapter.clear();
    toPage.clear();
  };
  return {
    page: {
      send: (message) => {
        deliver(toAdapter, message);
      },
      listen: (listener) => {
        toPage.add(listener);
        return () => toPage.delete(listener);
      },
      close,
    },
    adapter: {
      send: (message) => {
        deliver(toPage, message);
      },
      listen: (listener) => {
        toAdapter.add(listener);
        return () => toAdapter.delete(listener);
      },
      close,
    },
  };
}
