import * as Y from 'yjs';

import type {
  BoardObject,
  EffectStyleTable,
  ObjectId,
  Page,
  PageId,
  TextStyleTable,
  TokenTable,
} from '@canvas/schema';

import type { DocumentVersionError } from '../meta/document-version-error.js';
import type { TransactionOrigin } from '../origin/transaction-origin.js';
import { LastKnownObjects } from '../repair/last-known-objects.js';

import { referencesView } from './cache-views.js';
import type {
  BoardSnapshot,
  ChangeSet,
  DocumentStore,
  DocumentTransaction,
  DocumentUpdate,
  RepairMode,
} from './document-store.js';
import type { ApplyUpdateInStepsOptions, ApplyUpdateOptions } from './document-update.js';
import { DocumentVersionGuard } from './document-version-guard.js';
import { HeldDeletes } from './held-deletes.js';
import { registerInternals } from './internal.js';
import { notifyAll } from './notify-all.js';
import { ObjectCache } from './object-cache.js';
import { objectEventsObserver } from './object-event-changes.js';
import { PageEvents } from './page-events.js';
import type { BoardReferences } from './reference-index.js';
import { applyRemote, applyRemoteInSteps, type RemoteApplyHost } from './remote-apply.js';
import { applyAndReport } from './remote-update.js';
import { openSide } from './side-maps.js';
import { assignClientId, type YjsDocumentStoreOptions } from './store-options.js';
import { StoreRepairs } from './store-repairs.js';
import { NESTED_TRANSACTION_MESSAGE, RunGate } from './store-run.js';
import type { RunnableStore, RunStopReason, StoreBusyError, StoreRun } from './store-run.js';
import { encodeSyncState } from './sync-state.js';
import { TransactionOrigins } from './transaction-origins.js';
import { YjsTransaction } from './yjs-transaction.js';
import { YjsUpdateSubscription } from './yjs-update-subscription.js';

/**
 * The name of the document's top-level object type: a `Y.Map` from object id to the object's
 * `Y.Map`. The board metadata map lives alongside it; the codec owns
 * each object's field layout. This name is part of the persisted document format.
 */
export const OBJECTS_MAP_NAME = 'objects';

/**
 * The Yjs implementation of {@link DocumentStore}: it owns one `Y.Doc` whose `objects` map holds
 * every object as a `Y.Map` laid out by the codec (`codec/object-layout.ts`). Local writes go
 * through validated transactions carrying an origin; remote updates are applied as they come.
 * The decoded view (snapshot, `get`, reverse indexes) is updated lazily on the next read after a
 * change. Single-threaded.
 */
export class YjsDocumentStore implements DocumentStore, RunnableStore {
  readonly #doc = new Y.Doc();
  /** Remote deletions held back while structs are pending (`held-deletes.ts`). */
  readonly #heldDeletes = new HeldDeletes();
  readonly #objects = this.#doc.getMap<unknown>(OBJECTS_MAP_NAME);
  /** The board's pages, colour tokens and named styles (`side-maps.ts`). */
  readonly #side = openSide(this.#doc);
  /** @inheritdoc */
  readonly boardTimer: DocumentStore['boardTimer'] = this.#side.timer;
  /** @inheritdoc */
  readonly stickyAuthors: DocumentStore['stickyAuthors'] = this.#side.stickyAuthors;
  readonly #version = new DocumentVersionGuard(this.#doc, this.#objects);
  /** Objects removed from the board, as last seen, for the reference repair. */
  readonly #lastKnown = new LastKnownObjects();
  readonly #cache = new ObjectCache(this.#objects, this.#lastKnown, this.#side);
  /** The read-only view `references` hands out, so callers never reach the cache itself. */
  readonly #references = referencesView(this.#cache);
  readonly #changeListeners = new Set<(changes: ChangeSet) => void>();
  readonly #updates: YjsUpdateSubscription;
  /** Origins this store validated, so a transaction's origin can be told from Yjs's own. */
  readonly #origins = new TransactionOrigins();
  /** The ids an `applyUpdate` in progress changed, collected for the reference repair. */
  #changedByUpdate: Set<ObjectId> | undefined;
  /** The pages map's events. */
  readonly #pageEvents = new PageEvents({
    cache: this.#cache,
    styles: this.#side.styles,
    isApplyingUpdate: () => this.#changedByUpdate !== undefined,
    originOf: (origin) => this.#origins.of(origin),
    listeners: this.#changeListeners,
  });
  /** The repair mode and the reference repair (`store-repairs.ts`). */
  readonly #repairs: StoreRepairs;
  /** The open run, if any, that holds the store across tasks (`store-run.ts`). */
  readonly #runs = new RunGate();
  #isTransacting = false;
  #isStepping = false;
  #isDestroyed = false;

  /**
   * Creates a store over a new, empty document.
   *
   * @param options - Optional settings.
   * @param options.clientId - The Yjs client id to write with, instead of a random one: for
   *   tests that must replay exactly (concurrent writes are merged in client-id order). Every
   *   store editing one document needs a different id; two sharing one corrupt the document.
   * @param options.repairMode - Automatic repair writes or read-only projection; default write.
   * @throws {RangeError} When `clientId` is not an unsigned 32-bit integer.
   */
  constructor(options: YjsDocumentStoreOptions = {}) {
    const { clientId } = options;
    this.#repairs = new StoreRepairs({
      store: this,
      objects: this.#objects,
      cache: this.#cache,
      lastKnown: this.#lastKnown,
      side: this.#side,
      mode: options.repairMode ?? 'write',
    });
    assignClientId(this.#doc, clientId);
    registerInternals(this, {
      doc: this.#doc,
      objects: this.#objects,
      pages: this.#side.pages,
      tokens: this.#side.tokens,
      styles: this.#side.styles.sources,
      lastKnown: this.#lastKnown,
      cycleRepairs: (changed) => this.#cache.cycleRepairs(changed),
      repairReferences: (touched, isPagesChanged) =>
        this.#repairs.references(touched, isPagesChanged),
      stampBeforeWrite: () => {
        this.#version.stampBeforeWrite();
      },
      runs: this.#runs,
      beginRun: () => this.beginRun(),
    });
    this.#pageEvents.observe(this.#side, true);
    this.#objects.observeDeep(this.#onObjectEvents);
    this.#updates = new YjsUpdateSubscription(this.#doc, (origin) => this.#origins.of(origin));
  }

  /** @inheritdoc */
  setRepairMode(mode: RepairMode): void {
    this.#checkAlive();
    this.#runs.check();
    if (mode === this.#repairs.mode) return;
    this.#checkIdle();
    this.#repairs.switchMode(
      mode,
      (changes) => {
        this.#isTransacting = true;
        try {
          notifyAll(this.#changeListeners, changes);
        } finally {
          this.#isTransacting = false;
        }
      },
      () => this.#isDestroyed,
    );
  }

  /** @inheritdoc */
  get references(): BoardReferences {
    this.#checkAlive();
    return this.#references;
  }

  /** @inheritdoc */
  read(): BoardSnapshot {
    this.#checkAlive();
    return this.#cache.read();
  }

  /** @inheritdoc */
  readPages(): ReadonlyMap<PageId, Page> {
    this.#checkAlive();
    return this.#cache.pages();
  }

  /** @inheritdoc */
  readTokens(): TokenTable {
    this.#checkAlive();
    return this.#cache.tokens();
  }

  /** @inheritdoc */
  readTextStyles(): TextStyleTable {
    this.#checkAlive();
    return this.#side.styles.table('text');
  }

  /** @inheritdoc */
  readEffectStyles(): EffectStyleTable {
    this.#checkAlive();
    return this.#side.styles.table('effect');
  }

  /** @inheritdoc */
  get(id: ObjectId): BoardObject | undefined {
    this.#checkAlive();
    return this.#cache.get(id);
  }

  /**
   * @inheritdoc
   * @throws {RangeError} When `origin` is not a valid origin.
   * @throws {Error} When called inside a transaction or a listener, or after `destroy()`.
   */
  transact<Result>(
    origin: TransactionOrigin,
    mutate: (transaction: DocumentTransaction) => Result,
  ): Result {
    this.#checkIdle();
    const validOrigin = this.#origins.issue(origin);
    this.#cache.flush();
    const transaction = new YjsTransaction(
      this.#objects,
      this.#side,
      validOrigin,
      () => {
        this.#version.stampBeforeWrite();
      },
      (current) => this.#cache.placementBase(current),
      (id) => this.#cache.get(id),
      (object) => this.#runs.isCertified(object),
    );
    this.#isTransacting = true;
    try {
      return this.#doc.transact(() => mutate(transaction), validOrigin);
    } finally {
      transaction.close();
      this.#isTransacting = false;
    }
  }

  /** @inheritdoc */
  subscribe(listener: (changes: ChangeSet) => void): () => void {
    this.#checkAlive();
    this.#cache.flush();
    this.#changeListeners.add(listener);
    return () => this.#changeListeners.delete(listener);
  }

  /** @inheritdoc */
  subscribeUpdates(listener: (update: DocumentUpdate) => void): () => void {
    this.#checkAlive();
    return this.#updates.add(listener);
  }

  /** @inheritdoc */
  encodeState(stateVector?: Uint8Array): Uint8Array {
    this.#checkAlive();
    return this.#heldDeletes.withHeld(Y.encodeStateAsUpdate(this.#doc, stateVector));
  }

  /** @inheritdoc */
  encodeSyncState(stateVector?: Uint8Array): Uint8Array {
    this.#checkAlive();
    return this.#heldDeletes.withHeld(encodeSyncState(this.#doc, stateVector));
  }

  /** @inheritdoc */
  get clientId(): number {
    return this.#doc.clientID;
  }

  /** @inheritdoc */
  get versionError(): DocumentVersionError | undefined {
    return this.#version.error;
  }

  /** @inheritdoc */
  get hasPendingStructs(): boolean {
    this.#checkAlive();
    return this.#doc.store.pendingStructs !== null;
  }

  /** @inheritdoc */
  encodeStateVector(): Uint8Array {
    this.#checkAlive();
    return Y.encodeStateVector(this.#doc);
  }

  /** @inheritdoc */
  applyUpdate(update: Uint8Array, origin: TransactionOrigin, options?: ApplyUpdateOptions): void {
    applyRemote(this.#remote, update, origin, options);
  }

  /** @inheritdoc */
  applyUpdateInSteps(
    update: Uint8Array,
    origin: TransactionOrigin,
    options: ApplyUpdateInStepsOptions,
  ): Promise<void> {
    this.#runs.check(); // At once, not as a rejection, while a run holds the store.
    return applyRemoteInSteps(this.#remote, update, origin, options);
  }

  /** @inheritdoc */
  beginRun(): StoreRun {
    this.#checkIdle();
    return this.#runs.begin();
  }

  /** @inheritdoc */
  whenIdle(): Promise<void> {
    return this.#runs.whenIdle();
  }

  /** @inheritdoc */
  get isRunning(): boolean {
    return this.#runs.isOpen;
  }

  /** @inheritdoc */
  requestStop(reason: RunStopReason): void {
    this.#runs.requestStop(reason);
  }

  /** @inheritdoc */
  destroy(): void {
    if (this.#isDestroyed) return;
    this.#isDestroyed = true;
    this.#runs.destroy();
    this.#objects.unobserveDeep(this.#onObjectEvents);
    this.#pageEvents.observe(this.#side, false);
    this.#changeListeners.clear();
    this.#updates.clear();
    this.#doc.destroy();
  }

  /**
   * Throws after `destroy()`.
   *
   * @throws {Error} When the store has been destroyed.
   */
  #checkAlive(): void {
    if (this.#isDestroyed) throw new Error('The document store has been destroyed');
  }

  /**
   * Throws inside a transaction or a listener callback, or while another writer's run holds it.
   *
   * @throws {Error} When a transaction or update is running, or the store has been destroyed.
   * @throws {StoreBusyError} When a run is open and this write is outside its `enter`.
   * @throws {DocumentVersionError} When the store holds a document this build cannot read.
   */
  #checkIdle(): void {
    this.#checkAlive();
    if (this.#version.error !== undefined) throw this.#version.error;
    if (this.#isTransacting || this.#isStepping) {
      throw new Error(NESTED_TRANSACTION_MESSAGE);
    }
    this.#runs.check();
  }

  /** The store's side of `applyUpdate` and `applyUpdateInSteps` (`remote-apply.ts`). */
  readonly #remote: RemoteApplyHost = {
    checkIdle: () => {
      this.#checkIdle();
    },
    issue: (origin) => this.#origins.issue(origin),
    integrate: (update, shape, origin, isSilent) => {
      const changed = new Set<ObjectId>();
      this.#isTransacting = true;
      this.#changedByUpdate = changed;
      this.#pageEvents.takeUpdateChange();
      let failure: { readonly error: unknown } | undefined;
      try {
        failure = this.#updates.applying(isSilent, (listeners) =>
          applyAndReport(this.#doc, update, shape, this.#heldDeletes, origin, listeners),
        );
      } finally {
        this.#isTransacting = false;
        this.#changedByUpdate = undefined;
      }
      return { failure, changed, isPagesChanged: this.#pageEvents.takeUpdateChange() };
    },
    check: ({ changed }) => {
      this.#version.check(changed);
    },
    repair: ({ changed, isPagesChanged }) => {
      if (!this.#isDestroyed) this.#repairs.references(changed, isPagesChanged);
    },
    isDestroyed: () => this.#isDestroyed,
    setStepping: (isStepping) => {
      this.#isStepping = isStepping;
    },
  };

  /** Marks what a transaction changed and delivers its change set. */
  readonly #onObjectEvents = objectEventsObserver({
    origins: this.#origins,
    source: this.#objects,
    cache: this.#cache,
    touched: () => this.#changedByUpdate,
    listeners: this.#changeListeners,
    sideEvents: this.#pageEvents,
  });
}
