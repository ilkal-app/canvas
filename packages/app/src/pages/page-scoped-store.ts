import type { DocumentVersionError } from '@canvas/document';
import {
  afterParts,
  forwardUndoSteps,
  isApplyingInParts,
  SYSTEM_ORIGIN,
  type BoardReferences,
  type BoardSnapshot,
  type ChangeSet,
  type DocumentStore,
  type DocumentTransaction,
  type DocumentUpdate,
  type RepairMode,
  type TransactionOrigin,
} from '@canvas/document';
import type {
  BoardObject,
  EffectStyleTable,
  ObjectId,
  Page,
  PageId,
  TextStyleTable,
  TokenTable,
} from '@canvas/schema';

import { pageChangeOf } from './page-change-translation.js';
import type { PageIndex } from './page-index.js';
import { type PageMove } from './page-index.js';
import { pageReferences } from './page-references.js';
import { pageSnapshot } from './page-snapshot.js';
import { PageTransaction } from './page-transaction.js';
import { PageChangeQueue } from './pending-page-changes.js';
import { parentsFirst, SlicedPageSwitch, type PageSlicing } from './sliced-page-switch.js';

/** Hears every change set of the whole board, with the pages its objects were and are on. */
export type BoardChangeListener = (
  changes: ChangeSet,
  moves: ReadonlyMap<ObjectId, PageMove>,
  pageOf: (id: ObjectId) => PageId | undefined,
) => void;

/** No ids. */
const NONE: readonly ObjectId[] = Object.freeze([]);

/**
 * The document as the person sees it on one page: a `DocumentStore` over the whole board
 * that shows only the current page's objects. Reads (`read`, `get`, the reverse indexes) leave the
 * other pages out; change sets are translated, an object moving onto the page created and one
 * leaving it deleted, so the scene, the hit-test index, the tools and the panels built on it index,
 * cull and draw the current page alone, and a switch is one change set that deletes the old page's
 * objects and creates the new page's. Writes go to the whole board; a new root object written
 * without a page goes on the current page. Undo histories and the sync client work on the whole
 * board, never on this view. Main thread.
 */
export class PageScopedStore implements DocumentStore {
  /** @inheritdoc */
  readonly boardTimer: DocumentStore['boardTimer'];
  /** @inheritdoc */
  readonly stickyAuthors: DocumentStore['stickyAuthors'];
  readonly #store: DocumentStore;
  readonly #index: PageIndex;
  readonly #listeners = new Set<(changes: ChangeSet) => void>();
  readonly #boardListeners = new Set<BoardChangeListener>();
  readonly #stopListening: () => void;
  /** The page's change sets held while a command's parts are applied. */
  readonly #queue = new PageChangeQueue((changes) => {
    this.#notify(changes);
  });
  readonly #stopAfterParts: () => void;
  #page: PageId;
  #snapshot: { readonly source: BoardSnapshot; readonly view: BoardSnapshot } | undefined;
  #roots: ReadonlySet<ObjectId> | undefined;
  #switch: SlicedPageSwitch | undefined;

  /**
   * Shows one page of a board.
   *
   * @param store - The whole board.
   * @param index - The board's page index, which follows the store.
   * @param page - The page to show first.
   */
  constructor(store: DocumentStore, index: PageIndex, page: PageId) {
    this.#store = store;
    this.boardTimer = store.boardTimer;
    this.stickyAuthors = store.stickyAuthors;
    this.#index = index;
    this.#page = page;
    // A command split in parts groups them on the store a history records.
    forwardUndoSteps(this, store);
    this.#stopListening = store.subscribe((changes) => {
      const moves = this.#index.apply(changes);
      this.#follow(changes, moves);
      for (const listener of [...this.#boardListeners]) {
        listener(changes, moves, (id) => this.#index.pageOf(id));
      }
    });
    // A split command's parts, or a grouped undo or redo, reach page listeners as one change
    // set when they end, still before `runCommand` returns.
    this.#stopAfterParts = afterParts(store, () => {
      this.#queue.endParts();
    });
  }

  /**
   * The page shown.
   *
   * @returns Its id.
   */
  get page(): PageId {
    return this.#page;
  }

  /**
   * The page an object of the whole board is shown on, whichever page this store shows.
   *
   * @param id - The object.
   * @returns The page, or `undefined` for an object not on the board.
   */
  pageOf(id: ObjectId): PageId | undefined {
    return this.#index.pageOf(id);
  }

  /**
   * Where a new root object goes: the page shown (`BoardReader.defaultPageId`).
   *
   * @returns The page shown.
   */
  defaultPageId(): PageId {
    return this.#page;
  }

  /**
   * Shows another page: one change set (the system's, not local) deletes what the page shown
   * had and creates what the new one has.
   *
   * @param page - The page to show.
   */
  show(page: PageId): void {
    if (page === this.#page) return;
    const deleted = this.#announcedOnPage();
    this.#page = page;
    this.#invalidate();
    this.#announce(this.#index.idsOn(page).sort(), deleted);
  }

  /**
   * Shows another page at once, announcing its objects a slice per task, parents first, under a
   * store run (`SlicedPageSwitch`); a later switch or `destroy` stops it.
   *
   * @param page - The page to show.
   * @param slicing - The slice size and how to end a task.
   * @param canOpenRun - False inside the store's change notification, where no run may begin.
   * @returns Resolves once every object is announced or the switch stopped.
   */
  showInSlices(page: PageId, slicing: PageSlicing, canOpenRun = true): Promise<void> {
    if (page === this.#page) return Promise.resolve();
    const deleted = this.#announcedOnPage();
    this.#page = page;
    this.#invalidate();
    const parentOf = (id: ObjectId): ObjectId | null => {
      const parentId = this.#store.get(id)?.parentId ?? null;
      return parentId !== null && this.#isShown(parentId) ? parentId : null;
    };
    const order = parentsFirst(this.#index.idsOn(page), parentOf);
    let adopted: SlicedPageSwitch | undefined;
    const { done } = new SlicedPageSwitch({
      ...{ store: this.#store, canOpenRun, order, slicing, deleted },
      announce: this.#announce,
      adopt: (sliced) => (this.#switch = adopted = sliced),
    });
    // Once done, reads need not filter by what it owed; an older switch never clears a newer one.
    return done.finally(() => {
      if (this.#switch === adopted) this.#switch = undefined;
    });
  }

  /**
   * How many objects a page holds, descendants included. Cost: the board.
   *
   * @param page - The page.
   * @returns The count.
   */
  countOn(page: PageId): number {
    return this.#index.idsOn(page).length;
  }

  /** @inheritdoc */
  setRepairMode(mode: RepairMode): void {
    this.#store.setRepairMode(mode);
  }

  /** @inheritdoc */
  read(): BoardSnapshot {
    const source = this.#store.read();
    if (this.#snapshot?.source !== source) {
      this.#snapshot = { source, view: pageSnapshot(source, (id) => this.#isShown(id)) };
    }
    return this.#snapshot.view;
  }

  /** @inheritdoc */
  readPages(): ReadonlyMap<PageId, Page> {
    return this.#store.readPages();
  }

  /** @inheritdoc */
  readTokens(): TokenTable {
    return this.#store.readTokens();
  }

  /** @inheritdoc */
  readTextStyles(): TextStyleTable {
    return this.#store.readTextStyles();
  }

  /** @inheritdoc */
  readEffectStyles(): EffectStyleTable {
    return this.#store.readEffectStyles();
  }

  /** @inheritdoc */
  get(id: ObjectId): BoardObject | undefined {
    return this.#isShown(id) ? this.#store.get(id) : undefined;
  }

  /** @inheritdoc */
  get references(): BoardReferences {
    return pageReferences(this.#store.references, {
      isShown: (id) => this.#isShown(id),
      rootIds: () => this.#rootIds(),
      isSwitching: () => this.#switch !== undefined,
    });
  }

  /** @inheritdoc */
  transact<Result>(
    origin: TransactionOrigin,
    mutate: (transaction: DocumentTransaction) => Result,
  ): Result {
    return this.#store.transact(origin, (transaction) =>
      mutate(new PageTransaction(transaction, this.#page)),
    );
  }

  /** @inheritdoc */
  subscribe(listener: (changes: ChangeSet) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Listens for every change set of the whole board, after this view followed it.
   *
   * @param listener - The listener.
   * @returns A function that stops listening.
   */
  subscribeBoard(listener: BoardChangeListener): () => void {
    this.#boardListeners.add(listener);
    return () => this.#boardListeners.delete(listener);
  }

  /** @inheritdoc */
  subscribeUpdates(listener: (update: DocumentUpdate) => void): () => void {
    return this.#store.subscribeUpdates(listener);
  }

  /** @inheritdoc */
  encodeState(stateVector?: Uint8Array): Uint8Array {
    return this.#store.encodeState(stateVector);
  }

  /** @inheritdoc */
  encodeSyncState(stateVector?: Uint8Array): Uint8Array {
    return this.#store.encodeSyncState(stateVector);
  }

  /** @inheritdoc */
  get clientId(): number {
    return this.#store.clientId;
  }

  /** @inheritdoc */
  get versionError(): DocumentVersionError | undefined {
    return this.#store.versionError;
  }

  /** @inheritdoc */
  get hasPendingStructs(): boolean {
    return this.#store.hasPendingStructs;
  }

  /** @inheritdoc */
  encodeStateVector(): Uint8Array {
    return this.#store.encodeStateVector();
  }

  /** @inheritdoc */
  applyUpdate(update: Uint8Array, origin: TransactionOrigin): void {
    this.#store.applyUpdate(update, origin);
  }

  /** Stops following the board; the board itself is its owner's to destroy. */
  destroy(): void {
    this.#switch?.stop();
    this.#stopListening();
    this.#stopAfterParts();
    this.#listeners.clear();
    this.#boardListeners.clear();
  }

  /**
   * The page shown's objects listeners were told of, sorted; stops a sliced switch under way.
   *
   * @returns The ids.
   */
  #announcedOnPage(): ObjectId[] {
    const sliced = this.#switch;
    this.#switch = undefined;
    return SlicedPageSwitch.announced(sliced, this.#index.idsOn(this.#page));
  }

  /**
   * Tells listeners of a switch's objects: created on the page shown, deleted from the last.
   *
   * @param created - Announced now on the page shown.
   * @param deleted - Gone with the page left.
   */
  readonly #announce = (created: readonly ObjectId[], deleted: readonly ObjectId[]): void => {
    this.#invalidate();
    this.#notify({ origin: SYSTEM_ORIGIN, isLocal: false, created, updated: NONE, deleted });
  };

  /**
   * Whether an object is on the page shown.
   *
   * @param id - The object.
   * @returns True when it is.
   */
  #isShown(id: ObjectId): boolean {
    // A sliced switch reveals an object once announced, so readers agree with listeners.
    return this.#index.pageOf(id) === this.#page && this.#switch?.owed.has(id) !== true;
  }

  /**
   * The root objects on the page shown, worked out once per change.
   *
   * @returns Their ids.
   */
  #rootIds(): ReadonlySet<ObjectId> {
    this.#roots ??= new Set(
      [...this.#store.references.childrenOf(null)].filter((id) => this.#isShown(id)),
    );
    return this.#roots;
  }

  /** Forgets what was worked out for the board as it was. */
  #invalidate(): void {
    this.#snapshot = undefined;
    this.#roots = undefined;
  }

  /**
   * Translates one change set of the whole board into the page's.
   *
   * @param changes - The board's change set.
   * @param moves - The objects whose page changed, came or went.
   */
  #follow(changes: ChangeSet, moves: ReadonlyMap<ObjectId, PageMove>): void {
    this.#invalidate();
    const owed = this.#switch?.owed;
    const page = pageChangeOf(changes, moves, this.#page, (id) => this.#index.pageOf(id), owed);
    if (page !== undefined && !this.#queue.hold(page, isApplyingInParts(this.#store))) {
      this.#notify(page);
    }
  }

  /**
   * Delivers a change set to every listener; the first error is rethrown after all ran.
   *
   * @param changes - The change set.
   * @throws {unknown} The first error a listener threw.
   */
  #notify(changes: ChangeSet): void {
    const frozen = Object.freeze(changes);
    const errors: unknown[] = [];
    for (const listener of [...this.#listeners]) {
      try {
        listener(frozen);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw errors[0];
  }
}
