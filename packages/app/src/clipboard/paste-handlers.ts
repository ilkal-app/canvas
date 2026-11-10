import type { LinkUnfurlOutcome, NewObject } from '@canvas/document';
import type { AssetId, ObjectId, Point } from '@canvas/schema';

import type { LinkPreview } from '../assets/assets-request-types.js';

/** One thing on the clipboard a paste can read: a string flavour or a file. */
export type PasteItem =
  | {
      /** A string flavour (`text/plain`, `text/html`, the canvas's objects). */
      readonly kind: 'string';
      /** Its MIME type. */
      readonly type: string;
      /** Its data. */
      readonly data: string;
    }
  | {
      /** A file, such as a copied image. */
      readonly kind: 'file';
      /** Its MIME type. */
      readonly type: string;
      /** The file. */
      readonly file: File;
    };

/**
 * Where a paste goes, as the engine gives it: the board under the canvas, at the pointer or the
 * view's centre, and the command that creates what the paste makes. It stays usable after the
 * paste event, so a handler that must wait (an image upload) creates its objects when it
 * can.
 */
export interface PasteLocation {
  /** The pointer on the board, world units, or `undefined` while it is off the canvas. */
  readonly pointer: Point | undefined;
  /** The board point at the centre of the view, world units. */
  readonly viewCentre: Point;
  /**
   * Creates objects as one `createObjects` command of the local user (one undo step) at the
   * board root, a part per task, and selects the new top-level objects once it is done.
   * During a drag it creates nothing and tells the person to finish the drag first. A refusal or
   * a stop partway is told to the person.
   *
   * @param objects - The objects as `createObjects` lists them.
   * @param onCreated - Given the new ids in list order once all of them are in; never after a
   *   refusal or a stop.
   * @returns False when refused at once (mid-drag, read-only, busy, nothing to create); true when
   *   the command started, whatever it then does.
   */
  createObjects(
    objects: readonly NewObject[],
    onCreated?: (ids: readonly ObjectId[]) => void,
  ): boolean;
  /** The board the paste goes to, when the page knows it (the copy flavour names it too). */
  readonly boardId?: string | undefined;
  /** The page's images, where it has an assets service; absent otherwise. */
  readonly images?: PasteImages | undefined;
  /**
   * Fetches a pasted link's preview through the assets service, where the page has
   * one; absent otherwise, when a pasted link's card is marked failed.
   *
   * @param url - The link.
   * @returns The preview; rejects when the page could not be had.
   */
  unfurlLink?(url: string): Promise<LinkPreview>;
  /**
   * Writes a fetched preview into a link card this client pasted (`applyLinkUnfurl`):
   * once, while it is pending and its key matches; no undo step of its own.
   *
   * @param id - The card.
   * @param update - Its key and what the fetch gave.
   * @returns Whether the card took it.
   */
  applyLinkUnfurl?(id: ObjectId, update: LinkCardUpdate): boolean;
  /**
   * Puts a failed link card back to pending under a new fetch key (the card's Retry,
   * `retryLinkUnfurl`), so this client fetches its page again.
   *
   * @param id - The card.
   * @param unfurlKey - The new fetch's key.
   * @returns Whether the card took it: false when it has not failed or is gone.
   */
  retryLinkUnfurl?(id: ObjectId, unfurlKey: string): boolean;
  /**
   * Which of some assets this board's document already shows an image of: such an
   * asset is one the board holds, so a paste within the board may show it again. One pass over
   * the board for the whole paste. Absent: none is.
   *
   * @param assetIds - The assets a paste's images show.
   * @returns Those an image object of the board has.
   */
  shownImagesAmong?(assetIds: readonly AssetId[]): ReadonlySet<AssetId>;
}

/** What a paste can do with images, through the page's images. */
export interface PasteImages {
  /**
   * Uploads image files and places them centred on a point (refusing what the board cannot take
   * with a notice), creating them as one command.
   *
   * @param files - The files.
   * @param at - Where they go, world units.
   */
  insert(files: readonly File[], at: Point): void;
  /**
   * Tells whether this browser copied every one of the images from a board (the record of its
   * own copies). What a paste asks before it creates an image whose clipboard names a
   * source board, which any web page can write.
   *
   * @param assetIds - The images' assets.
   * @param board - The board the clipboard names as their source.
   * @returns Whether every (asset, board) pair is in the record.
   */
  wasCopiedFrom(assetIds: readonly AssetId[], board: string): boolean;
  /**
   * Links images copied from another board to this one, before they are created. It refuses,
   * before any token is asked for or any request is made, what this browser did not copy from
   * that board (`wasCopiedFrom`).
   *
   * @param assetIds - The images' assets.
   * @param sourceBoard - The board they were copied from.
   * @returns Settles once linked; rejects with a sentence for the person otherwise.
   */
  linkFrom(assetIds: readonly AssetId[], sourceBoard: string): Promise<void>;
}

/** What a link card's fetch gave, for `applyLinkUnfurl`. */
export interface LinkCardUpdate {
  /** The card's `unfurlKey`, naming the fetch. */
  readonly unfurlKey: string;
  /** The preview, or failure. */
  readonly outcome: LinkUnfurlOutcome;
}

/** Where a paste goes, and where its handlers report what they could not do. */
export interface PasteTarget extends PasteLocation {
  /**
   * The board the pasted items were copied from, as their board flavour (or their HTML) says;
   * undefined for a paste from elsewhere or an older copy.
   */
  readonly sourceBoard?: string | undefined;
  /**
   * Tells the person why a paste did less than asked (too large, refused by the board), through
   * the engine's `onNotice`.
   *
   * @param message - A sentence for the person.
   */
  notify(message: string): void;
  /**
   * Whether this paste is still the latest of its router: false once a later paste
   * began or the router ended, when a paste still being read in stages does nothing more.
   * Always current when absent.
   */
  readonly isCurrent?: () => boolean;
  /**
   * Whether the person asked for plain text (Mod+Shift+V): a pasted link then stays
   * text, as before cards.
   */
  readonly isPlainText?: boolean;
}

/**
 * Handles one clipboard item of a paste.
 *
 * @param item - An item whose type the handler was registered for.
 * @param target - Where the paste goes.
 * @returns Whether the paste is handled; `false` lets the next handler try.
 */
export type PasteHandler = (item: PasteItem, target: PasteTarget) => boolean;

/** A registered handler. */
interface PasteHandlerEntry {
  /** A MIME type, or a family such as `image/*`. */
  readonly mimeType: string;
  /** The handler. */
  readonly handler: PasteHandler;
  /** Higher priorities are tried first. */
  readonly priority: number;
}

/** When a handler is tried among the others. */
export interface PasteHandlerOptions {
  /**
   * Higher first; ties in registration order. The built-in handlers use 300 for the canvas's
   * objects flavour, 100 for HTML and 0 for plain text, so the image file handler at
   * 200 wins over the HTML that often comes with a copied image. Default 0.
   */
  readonly priority?: number;
}

/**
 * Tells whether a MIME type matches a registered type or family (`image/*`).
 *
 * @param pattern - The registered type.
 * @param type - The clipboard item's type.
 * @returns Whether it matches.
 */
function matchesType(pattern: string, type: string): boolean {
  const wanted = pattern.toLowerCase();
  const actual = type.toLowerCase();
  return wanted.endsWith('/*')
    ? actual.startsWith(wanted.slice(0, -1))
    : actual === wanted || actual.startsWith(`${wanted};`);
}

/**
 * The paste handlers of a clipboard router, by MIME type. A paste tries
 * them from the highest priority down; each gets every clipboard item of its type in turn, and
 * the first that returns `true` ends the paste.
 */
export class PasteHandlerRegistry {
  private entries: readonly PasteHandlerEntry[] = [];

  /**
   * Adds a handler.
   *
   * @param mimeType - The MIME type it reads, or a family such as `image/*`.
   * @param handler - The handler.
   * @param options - Its priority.
   * @returns A function that removes it again.
   */
  register(mimeType: string, handler: PasteHandler, options: PasteHandlerOptions = {}): () => void {
    const entry = { mimeType, handler, priority: options.priority ?? 0 };
    this.entries = [...this.entries, entry].sort(
      (first, second) => second.priority - first.priority,
    );
    return () => {
      this.entries = this.entries.filter((registered) => registered !== entry);
    };
  }

  /**
   * Offers a paste's items to the handlers, highest priority first.
   *
   * @param items - The clipboard's items.
   * @param target - Where the paste goes.
   * @returns Whether a handler took the paste.
   */
  dispatch(items: readonly PasteItem[], target: PasteTarget): boolean {
    for (const { mimeType, handler } of this.entries) {
      for (const item of items) {
        if (matchesType(mimeType, item.type) && handler(item, target)) return true;
      }
    }
    return false;
  }
}
