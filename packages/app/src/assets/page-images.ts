import type { AssetId, ObjectId, Point } from '@canvas/schema';
import { placeImages } from '@canvas/tools';

import { afterStoreIdle } from '../engine/after-store-idle.js';

import type { PageLink } from './asset-channel.js';
import type { AssetsHttp } from './assets-http.js';
import { AssetsHttpError } from './assets-responses.js';
import { AttachedLinks } from './attached-links.js';
import { BoardTokens } from './board-tokens.js';
import { PAGE_COPIED_ASSETS } from './copied-assets.js';
import { CopyLedger } from './copy-ledger.js';
import { EngineLinks } from './engine-links.js';
import { holdLocalImage, sendUnfinished } from './hold-local.js';
import { ImageAvailabilityCheck } from './image-availability.js';
import { planUploadBytesOf } from './image-files.js';
import { ImageUploads } from './image-uploads.js';
import {
  CROSS_BOARD_NOT_COPIED_MESSAGE,
  CROSS_BOARD_REFUSED_MESSAGE,
  CROSS_BOARD_UNAVAILABLE_MESSAGE,
  NO_IMAGES_MESSAGE,
} from './page-images-messages.js';
import type {
  BoardImageAccess,
  ImageInsertTarget,
  PageImagesOptions,
  ReplacementAsset,
} from './page-images-types.js';
import { documentVisibility, type PageVisibility } from './page-visibility.js';
import { prepareImageFiles, type PreparedFile } from './prepare-image-files.js';
import { ImagePreparer } from './prepare-image.js';
import { ProcessingImages } from './processing-images.js';
import { runUpload, withRetries } from './run-upload.js';
import { createXhrPut } from './xhr-put.js';

export { IMAGE_READER_FAILED_MESSAGE } from './prepare-image-files.js';
export * from './page-images-messages.js';
export type {
  BoardImageAccess,
  ImageInsertTarget,
  PageImagesOptions,
  ReplacementAsset,
} from './page-images-types.js';

/** Why no token is asked for or kept: the board's session ended. */

export { LOCAL_IMAGE_WAIT_MS } from './hold-local.js';

/**
 * The page's side of images: it answers the engine's adapter with the board's access
 * over the app's link (and pushes nothing else it does not ask for but local images and verified
 * uploads), reads dropped, pasted and picked files off the page's thread, refuses what the board
 * cannot take before anything is uploaded, places the rest (`placeImages`) as one
 * `createObjects`, hands their bytes to the adapter so they draw at once, and uploads them
 * (`ImageUploads`, `runUpload`); it links images pasted from another board before they are
 * created (`link`), and tells the adapter when the page is hidden or shown. Page.
 */
export class PageImages {
  /** The uploads, for the shell's badges. */
  readonly uploads: ImageUploads;
  /** A collaborator's images on screen still processing, for their spinners. */
  readonly processing = new ProcessingImages();
  /** Whether the board can show an image, for the style panel (a failed upload after reload). */
  readonly availability: ImageAvailabilityCheck;
  /**
   * What this browser copied images from: the stored record and this tab's own copies. Written
   * by the page's copies and cuts, and what `linkFrom` trusts.
   */
  readonly copies: CopyLedger;
  private readonly access: BoardImageAccess | undefined;
  private readonly board: string | undefined;
  private readonly preparer: ImagePreparer;
  private readonly uploadBytes: number | undefined;
  private readonly wait: (delayMs: number) => Promise<void>;
  /** The engines' links, one current: its access requests and upload reports. */
  private readonly links = new EngineLinks(
    (message) => {
      if (message.type === 'access-request') {
        if (!this.isEnded) void this.sendAccess();
      } else if (message.type === 'local-image-held') this.held.get(message.assetId)?.();
      else if (message.type === 'processing') {
        // A report already on its way when the session ended shows nothing.
        if (!this.isEnded) this.processing.set(message.assetIds);
      } else this.uploads.record(message.assetId, message.status, message.progress);
    },
    (link, isRestored) => {
      this.caughtUp(link, isRestored);
    },
  );
  /** Links of other engines (an export's) beside the connected one. */
  private readonly attached = new AttachedLinks({
    answer: (link, isRepeated) => void this.sendAccess(link, isRepeated),
    isHidden: () => this.isPageHidden(),
    isEnded: () => this.isEnded,
  });
  /** The board's tokens and the client that sends them. */
  private readonly tokens: BoardTokens;
  /** The local images the page waits for the adapter to hold, by asset. */
  private readonly held = new Map<AssetId, () => void>();
  /** Whether the board's session ended: nothing more is asked or sent. */
  private isEnded = false;
  private readonly visibility: PageVisibility | undefined;
  private readonly stopVisibility: (() => void) | undefined;

  /**
   * The page's images for a board.
   *
   * @param access - The board's assets and tokens, or undefined without an assets service.
   * @param options - The preparer, the put, the fetch and the wait.
   */
  constructor(access: BoardImageAccess | undefined, options: PageImagesOptions = {}) {
    this.access = access;
    this.copies = new CopyLedger(options.copiedAssets ?? PAGE_COPIED_ASSETS);
    this.board = options.boardId ?? access?.boardId;
    this.preparer = options.preparer ?? new ImagePreparer();
    this.uploadBytes = options.uploadBytes;
    this.tokens = new BoardTokens(access, options.fetch, () => this.hasEnded());
    this.wait =
      options.wait ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
    this.visibility = options.visibility ?? documentVisibility();
    this.stopVisibility = this.visibility?.listen(() => {
      this.sendVisibility();
    });
    const put = options.put ?? createXhrPut();
    const retries = { wait: this.wait, refreshAccess: () => this.tokens.refresh() };
    this.uploads = new ImageUploads(
      (image, file, onEvent, signal) =>
        runUpload(image, file, {
          ...retries,
          http: () => this.tokens.http(),
          put,
          onEvent,
          signal,
        }),
      (assetId) => {
        this.links.current?.send({ type: 'uploaded', assetId });
      },
      (assetId) => {
        this.links.current?.send({ type: 'forget-local', assetId });
      },
    );
    this.availability = new ImageAvailabilityCheck({
      readRecord: async (assetId) => {
        await this.tokens.current(false);
        return this.tokens.http().record(assetId);
      },
      isUploading: (assetId) => this.uploads.snapshot().some((entry) => entry.assetId === assetId),
      hasUploaded: (assetId) => this.uploads.hasAdded(assetId),
    });
  }

  /**
   * The board the page shows, when it knows it.
   *
   * @returns Its id, or undefined.
   */
  get boardId(): string | undefined {
    return this.board;
  }

  /**
   * Talks to an engine's adapter over a link, in place of the one before (`EngineLinks`): answers
   * its access requests and takes its reports of uploaded assets. The one before is parked, not
   * closed, and is current again once this one is released (the History preview borrows these
   * images over the mounted live engine).
   *
   * @param link - The page's end of the link.
   * @returns Releases the link, once its engine is destroyed.
   */
  connect(link: PageLink): () => void {
    return this.links.connect(link);
  }

  /**
   * Tells a link that became current the uploads under way (`sendUnfinished`), the page's
   * visibility and, to one restored, the session's end or a fresh access (it may have asked).
   *
   * @param link - The link.
   * @param isRestored - Whether it was parked.
   */
  private caughtUp(link: PageLink, isRestored: boolean): void {
    sendUnfinished(link, this.uploads);
    this.sendVisibility();
    if (!isRestored) return;
    if (this.isEnded) link.send({ type: 'session-ended' });
    else void this.sendAccess();
  }

  /**
   * Talks to another engine's adapter over a link beside the connected one (an export's capture,
   * `AttachedLinks`): answers its access requests and tells it the page's visibility and
   * the session's end. Uploads and local images stay the connected engine's; `connect` never
   * touches it.
   *
   * @param link - The page's end of the link.
   * @returns Stops answering and closes the link.
   */
  attach(link: PageLink): () => void {
    return this.attached.attach(link);
  }

  /**
   * Inserts image files centred on a point: refuses what the board cannot take with a notice,
   * reads the rest off the page's thread, creates them as one command, draws them from their
   * bytes at once and uploads them.
   *
   * @param files - The files.
   * @param at - Where the images go, world units.
   * @param target - Where objects are created and notices shown.
   * @returns Settles once their creation started; uploads queue once it is done.
   */
  async insert(files: readonly File[], at: Point, target: ImageInsertTarget): Promise<void> {
    const images = await this.prepareHeld(files, (message) => {
      target.notify(message);
    });
    if (images.length === 0 || !(await afterStoreIdle(target))) return;
    const placed = placeImages(
      images.map(({ image }) => image),
      at,
    );
    target.createObjects(placed, (ids) => {
      images.forEach(({ image, file }, index) => {
        const id = ids[index];
        if (id === undefined || this.isEnded) return;
        this.uploads.add(image, file, [id]);
      });
    });
  }

  /**
   * Replaces an image with a file without creating an object (an instance's image override,
   * Rule 3): refuses or reads the file as `insert` does, draws it from its bytes at
   * once, gives its asset to `apply`, which writes it, and uploads it for the objects `apply`
   * names (the upload's badge shows on them). Nothing is uploaded when `apply` could not use it.
   *
   * @param file - The file.
   * @param apply - Writes the asset; returns the objects that show it, or undefined if refused.
   * @param notify - Receives why the file was not taken.
   * @param store - The store `apply` writes to: it writes once no stepped run holds it.
   * @returns Settles once the asset was given and its upload queued.
   */
  async replace(
    file: File,
    apply: (asset: ReplacementAsset) => readonly ObjectId[] | undefined,
    notify: (message: string) => void,
    store?: ImageInsertTarget['store'],
  ): Promise<void> {
    const [prepared] = await this.prepareHeld([file], notify);
    if (prepared === undefined || !(await afterStoreIdle({ store }))) return;
    const { assetId, naturalSize } = prepared.image;
    const ids = apply({ assetId, naturalSize: { ...naturalSize } });
    if (ids !== undefined) this.uploads.add(prepared.image, prepared.file, ids);
  }

  /**
   * Reads files for upload and hands their bytes to the engine's adapter (`holdLocal`), with
   * the board's token held first; nothing without an assets service (the person is told) or once
   * the session ended, also when it ended meanwhile.
   *
   * @param files - The files.
   * @param notify - Receives why a file was not taken.
   * @returns The files read and held.
   */
  private async prepareHeld(
    files: readonly File[],
    notify: (message: string) => void,
  ): Promise<PreparedFile[]> {
    if (this.isEnded) return [];
    if (this.access === undefined) {
      notify(NO_IMAGES_MESSAGE);
      return [];
    }
    // Held before the uploads start; one that cannot be fetched is fetched again on a 401.
    const held = await this.tokens.current(false).catch(() => undefined);
    const uploadBytes = this.uploadBytes ?? planUploadBytesOf(held?.token);
    const images = await prepareImageFiles(files, this.preparer, notify, uploadBytes);
    await Promise.all(
      images.map(({ image, file }) => holdLocalImage(this.links.current, this.held, image, file)),
    );
    // The session may have ended while the files were read: nothing is created or uploaded.
    return this.hasEnded() ? [] : images;
  }

  /**
   * Links images copied from another board to this one, before their objects are written
   * (owner-confirmed proof of possession: an asset id alone grants nothing): each with a token
   * for the source board, which the page must be able to get. The gate is here, so that no
   * caller (a paste handler, a later refactor) can link from a board the clipboard merely
   * claims: every asset must be one this browser copied from that board
   * (`copies`), or the call rejects before any token is asked for or any request is made.
   *
   * @param assetIds - The images' assets.
   * @param sourceBoard - The board they were copied from.
   * @returns Settles once every one is linked; rejects with a sentence for the person otherwise.
   */
  async linkFrom(assetIds: readonly AssetId[], sourceBoard: string): Promise<void> {
    if (this.access === undefined || this.isEnded) throw new Error(NO_IMAGES_MESSAGE);
    if (assetIds.length === 0) return;
    if (!this.copies.wasCopiedFrom(assetIds, sourceBoard)) {
      throw new Error(CROSS_BOARD_NOT_COPIED_MESSAGE);
    }
    const sourceToken = await this.access.tokenFor(sourceBoard).catch(() => undefined);
    if (this.hasEnded()) throw new Error(NO_IMAGES_MESSAGE);
    if (sourceToken === undefined) throw new Error(CROSS_BOARD_UNAVAILABLE_MESSAGE);
    try {
      for (const assetId of new Set(assetIds)) {
        await this.request((http) => http.link(assetId, sourceBoard, sourceToken));
      }
    } catch (error) {
      if (this.hasEnded()) throw new Error(NO_IMAGES_MESSAGE);
      if (error instanceof AssetsHttpError && error.status === 0) {
        throw new Error('The images could not be pasted: the server could not be reached.');
      }
      throw new Error(CROSS_BOARD_REFUSED_MESSAGE);
    }
  }

  /**
   * Makes a request to the assets service for this board (the image panel's links):
   * with the board's token held, tried again while busy and once with a fresh token after a
   * `401`; none once the session ended.
   *
   * @param call - The request, given the client.
   * @returns What it gave.
   * @throws {Error} Once the session ended, or without an assets service.
   * @throws {AssetsHttpError} When the service refused it.
   */
  async request<T>(call: (http: AssetsHttp) => Promise<T>): Promise<T> {
    await this.tokens.current(false).catch(() => undefined);
    const retries = { wait: this.wait, refreshAccess: () => this.tokens.refresh() };
    return withRetries(() => call(this.tokens.http()), retries);
  }

  /**
   * The board's session ended while it was open: uploads stop (their requests are
   * aborted), the adapter's polls pause and it is told to make no request (`session-ended`), its
   * requests for access go unanswered, and no token is asked for, kept or handed out again; a
   * step that was waiting (a token, a link, an insert) makes no request when it resumes. What
   * was already drawn stays.
   */
  endSession(): void {
    this.isEnded = true;
    this.uploads.destroy();
    this.processing.set([]);
    this.sendVisibility();
    this.links.current?.send({ type: 'session-ended' });
    this.attached.send({ type: 'session-ended' });
  }

  /**
   * Whether the board's session ended (`endSession`), read afresh after an await.
   *
   * @returns Whether it did.
   */
  private hasEnded(): boolean {
    return this.isEnded;
  }

  /**
   * Stops talking to the adapter, reading files and uploading, lets every file go, and shows no
   * collaborator's image as processing any more.
   */
  destroy(): void {
    this.uploads.destroy();
    this.processing.set([]);
    this.stopVisibility?.();
    this.links.closeAll();
    this.attached.closeAll();
    this.preparer.destroy();
  }

  /** Tells the adapter whether the page is hidden, so its polls pause meanwhile. */
  private sendVisibility(): void {
    const isHidden = this.isPageHidden();
    this.links.current?.send({ type: 'page-visibility', isHidden });
    this.attached.send({ type: 'page-visibility', isHidden });
  }

  /**
   * Whether the adapters should pause: the page is hidden, or the session ended.
   *
   * @returns Whether they should.
   */
  private isPageHidden(): boolean {
    return this.isEnded || (this.visibility?.isHidden() ?? false);
  }

  /**
   * Answers an adapter's request with the access (`BoardTokens.answer`); nothing once the
   * session ended.
   *
   * @param target - The attached link that asked; the connected one if absent.
   * @param hasAsked - Whether that attached link asked before.
   */
  private async sendAccess(target?: PageLink, hasAsked = false): Promise<void> {
    const access = await this.tokens.answer(target === undefined ? undefined : hasAsked);
    if (access !== undefined) (target ?? this.links.current)?.send({ type: 'access', access });
  }
}
