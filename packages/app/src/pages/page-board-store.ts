import {
  forwardUndoSteps,
  type BoardReferences,
  type BoardSnapshot,
  type ChangeSet,
  type DocumentStore,
  type DocumentTransaction,
  type DocumentUpdate,
  type RepairMode,
  type TransactionOrigin,
  type DocumentVersionError,
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

import { PageTransaction } from './page-transaction.js';

/**
 * The whole board as a person on one page writes to it: reads, reverse indexes and
 * change sets are the whole board's, so a command sees a main's instances and an instance's main
 * wherever they are; writes go through `PageTransaction`, so a new root object given no page
 * goes on the page shown, as through `PageScopedStore`. The commands the person runs from the
 * page that reach across pages (deleting a main, pasting or duplicating an instance, the
 * component commands) run over this store. Main thread.
 */
export class PageBoardStore implements DocumentStore {
  /** @inheritdoc */
  readonly boardTimer: DocumentStore['boardTimer'];
  /** @inheritdoc */
  readonly stickyAuthors: DocumentStore['stickyAuthors'];
  readonly #store: DocumentStore;
  readonly #page: () => PageId;

  /**
   * Writes to a board from a page.
   *
   * @param store - The whole board.
   * @param page - The page shown, read at each write.
   */
  constructor(store: DocumentStore, page: () => PageId) {
    this.#store = store;
    this.boardTimer = store.boardTimer;
    this.stickyAuthors = store.stickyAuthors;
    this.#page = page;
    // A command split in parts groups them on the store a history records.
    forwardUndoSteps(this, store);
  }

  /**
   * Where a new root object goes: the page shown (`BoardReader.defaultPageId`).
   *
   * @returns The page shown.
   */
  defaultPageId(): PageId {
    return this.#page();
  }

  /** @inheritdoc */
  setRepairMode(mode: RepairMode): void {
    this.#store.setRepairMode(mode);
  }

  /** @inheritdoc */
  read(): BoardSnapshot {
    return this.#store.read();
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
    return this.#store.get(id);
  }

  /** @inheritdoc */
  get references(): BoardReferences {
    return this.#store.references;
  }

  /** @inheritdoc */
  transact<Result>(
    origin: TransactionOrigin,
    mutate: (transaction: DocumentTransaction) => Result,
  ): Result {
    const page = this.#page();
    return this.#store.transact(origin, (transaction) =>
      mutate(new PageTransaction(transaction, page)),
    );
  }

  /** @inheritdoc */
  subscribe(listener: (changes: ChangeSet) => void): () => void {
    return this.#store.subscribe(listener);
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

  /** Nothing: the board is its owner's to destroy, and this store holds nothing of its own. */
  destroy(): void {
    // The listeners subscribed through it are the board's, released with it.
  }
}
