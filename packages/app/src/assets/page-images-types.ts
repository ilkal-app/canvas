import type { DocumentStore, NewObject } from '@canvas/document';
import type { AssetId, ObjectId, PageId } from '@canvas/schema';

import type { AssetsFetch } from './assets-http.js';
import type { CopiedAssets } from './copied-assets.js';
import type { PageVisibility } from './page-visibility.js';
import type { ImagePixelSize, ImagePreparer } from './prepare-image.js';
import type { PutFile } from './run-upload.js';

// The shapes `PageImages` is built and called with (split from page-images.ts to keep it under
// the file limit).

/**
 * Where a board's images live and how the page gets its tokens: the
 * assets service, the board, the reader's token for it and, for a paste from another board, a
 * token for that one. Given by the board's connection; the tokens stay on the page and in the
 * engine's adapter, only ever in headers and request bodies.
 */
export interface BoardImageAccess {
  /** The assets service's base URL. */
  readonly assetsUrl: string;
  /** The board. */
  readonly boardId: string;
  /**
   * The reader's token for the board.
   *
   * @param isFresh - Whether the one held was refused, so a new one is fetched.
   * @returns The token.
   */
  token(isFresh: boolean): Promise<string>;
  /**
   * A token for another board, for linking what was copied from it (a paste between boards).
   *
   * @param boardId - The board.
   * @returns The token, or undefined when this page cannot get one.
   */
  tokenFor(boardId: string): Promise<string | undefined>;
}

/** Where inserted images go, as the engine's paste location gives it. */
export interface ImageInsertTarget {
  /**
   * Creates objects as one `createObjects` of the local user, selecting them (`PasteLocation`).
   *
   * @param objects - The objects.
   * @param onCreated - Given their ids once they are all in; never after a refusal or a stop.
   * @returns False when refused at once (mid-drag, read-only, busy).
   */
  createObjects(
    objects: readonly NewObject[],
    onCreated?: (ids: readonly ObjectId[]) => void,
  ): boolean;
  /**
   * Tells the person why an image was not taken.
   *
   * @param message - A sentence.
   */
  notify(message: string): void;
  /** The store written to: the images go in once no stepped run holds it. */
  readonly store?: DocumentStore;
  /** The page they go onto: they are dropped when it is gone by then. */
  readonly pageId?: PageId;
}

/** What `PageImages` is built with besides the access; tests inject all of it. */
export interface PageImagesOptions {
  /**
   * The board the page shows, which a copy names (the clipboard's board flavour), also without an
   * assets service; the access's board if absent.
   */
  readonly boardId?: string;
  /**
   * The board's plan's largest upload; by default read from the board token's `ent`
   * claim, else the board's own 100 MB.
   */
  readonly uploadBytes?: number;
  /** Reads files for upload; a worker-backed `ImagePreparer` by default. */
  readonly preparer?: ImagePreparer;
  /** Puts bytes with progress; `XMLHttpRequest` by default. */
  readonly put?: PutFile;
  /** The fetch; the page's by default. */
  readonly fetch?: AssetsFetch;
  /** Waits out a `Retry-After`, ms; `setTimeout` by default. */
  readonly wait?: (delayMs: number) => Promise<void>;
  /** Whether the page is hidden (the adapter's polls pause); the document's by default. */
  readonly visibility?: PageVisibility;
  /** The stored record of what this browser copied; the page's by default. */
  readonly copiedAssets?: CopiedAssets;
}

/** An image's asset as `PageImages.replace` gives it: what an image override writes. */
export interface ReplacementAsset {
  /** The asset. */
  readonly assetId: AssetId;
  /** Its upright size, px. */
  readonly naturalSize: ImagePixelSize;
}
