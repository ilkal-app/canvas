import type {
  BoardObject,
  BoardTimer,
  ObjectId,
  Page,
  PageId,
  Segment,
  TextStyle,
  TokenId,
  TokenTable,
  Vertex,
} from '@canvas/schema';

import type { MalformedUpdateError } from '../assets/update-bounds.js';
import type { UpdateDepthError } from '../assets/update-depth.js';
import type { TextStylePatch } from '../codec/style-attributes.js';
import type { BoardTimerView } from '../facilitation/board-timer-events.js';
import type { StickyAuthorsView } from '../facilitation/sticky-authors-events.js';
import type { DocumentVersionError } from '../meta/document-version-error.js';
import type { RestoreMarker } from '../meta/restore-marker.js';
import type { TransactionOrigin } from '../origin/transaction-origin.js';
import type { PageCreation } from '../pages/page-writes.js';
import type { TokenCreation, TokenWrite } from '../tokens/token-writes.js';

import type { BoardSnapshot } from './board-snapshot.js';
import type { ChangeSet } from './change-set.js';
import type {
  ApplyUpdateInStepsOptions,
  ApplyUpdateOptions,
  DocumentUpdate,
} from './document-update.js';
import type { BoardReferences } from './reference-index.js';
import type { NamedStyleReads, NamedStyleWrites } from './style-store.js';

export type { BoardSnapshot } from './board-snapshot.js';
export type { ChangeSet } from './change-set.js';
export type { DocumentUpdate } from './document-update.js';

/** Every field name of any object type (the union of their keys). */
export type ObjectFieldName = BoardObject extends infer Candidate
  ? Candidate extends BoardObject
    ? keyof Candidate
    : never
  : never;

/** The value types a field name has across the object types that have it. */
export type ObjectFieldValue<Key extends PropertyKey> = BoardObject extends infer Candidate
  ? Candidate extends unknown
    ? Key extends keyof Candidate
      ? Candidate[Key]
      : never
    : never
  : never;

/**
 * Fields to change on an object: any field of any object type except `id` and `type`. The
 * patched object is validated against its own type's schema, so a field the type lacks, or a
 * value of the wrong kind, is rejected at run time.
 */
export type ObjectPatch = {
  readonly [Key in Exclude<ObjectFieldName, 'id' | 'type'>]?: ObjectFieldValue<Key>;
};

/**
 * The mutation surface of one transaction. The command layer is its only caller. Every
 * write is validated against `@canvas/schema` before it touches the document and throws
 * `DocumentWriteError` (invalid values) or `RangeError` (a missing object, an index out of
 * range) without writing anything itself. Yjs has no rollback: writes made earlier in the same
 * transaction stay and are committed, and delivered to listeners and peers, when the transaction
 * ends. Validating a whole command before its first write is the command layer's job.
 */
export interface DocumentTransaction extends NamedStyleWrites {
  /**
   * Records restore intent in this transaction; relay attribution comes from authentication.
   *
   * @param marker - A validated part of one restore operation.
   */
  markRestore(marker: RestoreMarker): void;
  /** The origin this transaction carries. */
  readonly origin: TransactionOrigin;
  /**
   * Reads an object as it is now, inside this transaction (including this transaction's own
   * writes, which `DocumentStore#get` sees only after the transaction ends).
   *
   * @param id - The object id.
   * @returns The object, deep-frozen, or `undefined` when there is none or it cannot be read.
   */
  get(id: ObjectId): BoardObject | undefined;
  /**
   * Creates an object, or replaces the object with its id. Replacing an object of the same
   * type writes only the fields that differ, so concurrent edits to other fields survive; a
   * different type replaces the whole entry.
   *
   * @param object - The object; validated against its type's schema.
   */
  setObject(object: BoardObject): void;
  /**
   * Changes some fields of an object, writing only the fields whose value differs. Text,
   * labels and vector networks given here are brought to the new value by a minimal edit.
   *
   * @param id - The object id.
   * @param patch - The fields to change; the merged object is validated.
   */
  patchObject(id: ObjectId, patch: ObjectPatch): void;
  /**
   * The board's live pages as of now inside this transaction (its own page writes included), in
   * page order; the virtual default page alone when the board stores none.
   *
   * @returns The pages by id, in page order.
   */
  pages(): ReadonlyMap<PageId, Page>;
  /**
   * Writes a page: creates it when it is not live (its `identity`, `name` and
   * `order` keys; the default page with the identity every client writes alike), else writes its
   * name and order where they differ, so a rename and a reorder of one page merge. The virtual
   * default page is materialised first.
   *
   * @param page - The page as it should read; validated against `pageSchema`.
   * @param creation - Who creates it and when, recorded for a new page.
   */
  setPage(page: Page, creation: PageCreation): void;
  /**
   * Deletes a page's keys. Its objects are not touched: the command layer deletes them.
   *
   * @param pageId - The page.
   * @returns `true` when the page had a stored key.
   */
  deletePage(pageId: PageId): boolean;
  /**
   * The board's colour token table as of now inside this transaction (its own token writes
   * included).
   *
   * @returns The entries by id.
   */
  tokens(): TokenTable;
  /**
   * Writes a colour token: creates its entry when it is not stored (its
   * `identity`, and for a custom token its `name`), then writes its name and values where they
   * differ, so concurrent edits of different fields merge.
   *
   * @param token - The token as it should read; validated.
   * @param creation - Who creates it and when, recorded for a new entry.
   */
  setToken(token: TokenWrite, creation: TokenCreation): void;
  /**
   * Deletes a token's keys: a custom token's delete, or an edited built-in's reset. Objects
   * naming it are not touched (they draw as ink, `unknown-color-token`).
   *
   * @param tokenId - The token.
   * @returns `true` when the token had a stored key.
   */
  deleteToken(tokenId: TokenId): boolean;
  /**
   * Writes the board timer whole, or deletes it. The facilitation map is outside every
   * undo scope, so the write is never undone; it changes no object and adds no change set.
   *
   * @param timer - The timer, validated against `boardTimerSchema`, or `undefined` for none.
   */
  setBoardTimer(timer: BoardTimer | undefined): void;
  /**
   * Writes the board's "Show authors on stickies" setting, outside every undo scope.
   *
   * @param isShown - Whether the board shows its stickies' authors.
   */
  setStickyAuthors(isShown: boolean): void;
  /**
   * Deletes one object. Nothing cascades here: the command layer applies the schema's
   * `cascadeDelete` result, using {@link DocumentStore.references}.
   *
   * @param id - The object id.
   * @returns `true` when an object was deleted.
   */
  deleteObject(id: ObjectId): boolean;
  /**
   * Inserts characters into an object's text (a text or sticky body, or a shape or connector
   * label), in one style; concurrent inserts elsewhere in the text merge character-wise.
   *
   * @param id - The object id.
   * @param index - Where to insert, in UTF-16 code units; not inside a surrogate pair.
   * @param text - The characters.
   * @param style - Their style; validated.
   */
  insertText(id: ObjectId, index: number, text: string, style: TextStyle): void;
  /**
   * Deletes characters from an object's text. Emptying the text keeps the style of the first
   * deleted character as the style it types in next (the prototype's rule).
   *
   * @param id - The object id.
   * @param index - The first code unit to delete; not inside a surrogate pair.
   * @param length - How many code units to delete; the end is not inside a surrogate pair.
   */
  deleteText(id: ObjectId, index: number, length: number): void;
  /**
   * Restyles a range of an object's text with the given style fields only, so a concurrent
   * restyle of other fields on the same range survives. An empty range on empty text restyles
   * the style it types in.
   *
   * @param id - The object id.
   * @param index - The first code unit; not inside a surrogate pair.
   * @param length - How many code units; the end is not inside a surrogate pair.
   * @param patch - The style fields to set; validated.
   */
  formatText(id: ObjectId, index: number, length: number, patch: TextStylePatch): void;
  /**
   * Adds a vertex to a path, or updates the vertex with its id field by field.
   *
   * @param id - The path's id.
   * @param vertex - The vertex; validated, and the resulting network must be well formed.
   */
  setVertex(id: ObjectId, vertex: Vertex): void;
  /**
   * Deletes a vertex from a path. Delete the segments that end at it first: the resulting
   * network must be well formed.
   *
   * @param id - The path's id.
   * @param vertexId - The vertex id.
   * @returns `true` when a vertex was deleted.
   */
  deleteVertex(id: ObjectId, vertexId: string): boolean;
  /**
   * Adds a segment to a path, or updates the segment with its id field by field.
   *
   * @param id - The path's id.
   * @param segment - The segment; validated, and the resulting network must be well formed.
   */
  setSegment(id: ObjectId, segment: Segment): void;
  /**
   * Deletes a segment from a path.
   *
   * @param id - The path's id.
   * @param segmentId - The segment id.
   * @returns `true` when a segment was deleted.
   */
  deleteSegment(id: ObjectId, segmentId: string): boolean;
}

/** Whether automatic repairs write document history or only project the readable view. */
/** Agents keep legacy repairs but project component repairs without writing foreign mains. */
export type RepairMode = 'write' | 'agent-write' | 'read-only';

/**
 * The boundary between the board and its CRDT substrate: everything
 * above it (commands, undo, sync, the engine) works with schema objects, origins and opaque
 * update bytes, so replacing Yjs is a contained change. One implementation:
 * `YjsDocumentStore`. Single-threaded; not safe to share across workers.
 */
export interface DocumentStore extends NamedStyleReads {
  /**
   * The Yjs client id this store writes under now: what a peer's undo history records
   * as the writer of this store's changes, and what the collab client publishes its presence
   * under, so the relay's writer stamp and a person's presence name the same id. Yjs may pick a
   * new one when it sees another writer use it.
   */
  readonly clientId: number;
  /**
   * The layout or schema refusal this store hit (`DocumentVersionError`), after which it refuses
   * every write and update; undefined while it reads its board. A cache stamps a snapshot as
   * readable only from a store without one.
   */
  readonly versionError: DocumentVersionError | undefined;
  /**
   * Selects how automatic repairs run. Explicit local transactions remain available.
   *
   * @param mode - Writable repair, or a read-only projection for viewers.
   */
  setRepairMode(mode: RepairMode): void;
  /**
   * The board as an immutable snapshot, cached until the next change.
   *
   * @returns The snapshot.
   */
  read(): BoardSnapshot;
  /**
   * The board's live pages, as of the last completed transaction: `read().pages`, without
   * building the snapshot of the objects.
   *
   * @returns The pages by id, in page order; never empty.
   */
  readPages(): ReadonlyMap<PageId, Page>;
  /**
   * The board's colour token table, as of the last completed transaction: `read().tokens`,
   * without building the snapshot of the objects.
   *
   * @returns The entries by id, sorted.
   */
  readTokens(): TokenTable;
  /** The board timer: its value as of the last completed transaction, and its changes. */
  readonly boardTimer: BoardTimerView;
  /** The board's sticky author setting, as of the last completed transaction. */
  readonly stickyAuthors: StickyAuthorsView;
  /**
   * One object, as of the last completed transaction.
   *
   * @param id - The object id.
   * @returns The object, deep-frozen, or `undefined`.
   */
  get(id: ObjectId): BoardObject | undefined;
  /**
   * Reverse indexes over the board (children by parent, connectors by target, comments by
   * anchor), maintained incrementally from change sets, as of the last completed transaction.
   */
  readonly references: BoardReferences;
  /**
   * Runs `mutate` as one transaction carrying `origin`; its change set and update are delivered
   * after it returns. Transactions do not nest, and listeners must not start one
   * synchronously.
   *
   * @param origin - Who the changes are attributed to; validated.
   * @param mutate - The writes, made through the transaction it is given.
   * @returns What `mutate` returns.
   */
  transact<Result>(
    origin: TransactionOrigin,
    mutate: (transaction: DocumentTransaction) => Result,
  ): Result;
  /**
   * Listens for the change set of every transaction.
   *
   * @param listener - Called once per transaction that changed the object map, the pages or the
   *   colour tokens.
   * @returns A function that stops listening.
   */
  subscribe(listener: (changes: ChangeSet) => void): () => void;
  /**
   * Listens for the Yjs update of every transaction, for the sync client and persistence.
   *
   * @param listener - Called once per transaction that changed the document.
   * @returns A function that stops listening.
   */
  subscribeUpdates(listener: (update: DocumentUpdate) => void): () => void;
  /**
   * Encodes the document as one update (Yjs update format v1): the whole state, or only what a
   * peer with `stateVector` lacks.
   *
   * @param stateVector - A peer's state vector, from its `encodeStateVector()`.
   * @returns The update bytes.
   */
  encodeState(stateVector?: Uint8Array): Uint8Array;
  /**
   * Encodes integrated history and pending deletes for relay sync, excluding unresolved
   * structs. All pending bytes remain in this store and in `encodeState()` for persistence
   * and later dependencies. Never use this narrower encoding for cache compaction.
   *
   * @param stateVector - The relay's integrated clocks.
   * @returns Update-v1 bytes suitable for relay admission.
   */
  encodeSyncState(stateVector?: Uint8Array): Uint8Array;
  /** Whether unresolved structs are retained for missing dependencies (not pending deletes). */
  readonly hasPendingStructs: boolean;
  /**
   * Encodes this document's state vector, for a peer to compute what this one lacks.
   *
   * @returns The state vector bytes.
   */
  encodeStateVector(): Uint8Array;
  /**
   * Applies an update from a peer or from storage as one transaction. Objects in it are not
   * validated (CRDT updates are trusted at this layer; see the README).
   *
   * @param update - Update bytes, Yjs update format v1.
   * @param origin - Where the update is attributed to.
   * @param options - How it is applied: `isSilent` leaves update listeners out.
   * @throws {RangeError} When `origin` is not a valid origin.
   * @throws {Error} When called inside a transaction or a listener, after `destroy()`, or when
   *   Yjs cannot decode the update.
   * @throws {UpdateDepthError} Before any change, when plain values nest past the bound.
   * @throws {MalformedUpdateError} Before any change, when the bytes cannot be read within their
   *   length (a count larger than the bytes left, a read past the end).
   * @throws {DocumentVersionError} When the update brought objects created by a writer that left
   *   no metadata stamp (a board or build from before) or metadata naming a layout or
   *   schema this build cannot read; the store then refuses every later write and update
   *   (discard it), and runs no repair. Listeners have already seen the update's change sets
   *   and update bytes by then, so a local cache may hold the unreadable update until the
   *   relay's version gate clears the board.
   * @throws {unknown} What a listener threw; the reference repair still runs first.
   * @throws {AggregateError} When a listener threw and then the version check or the reference
   *   repair failed too (for example, a listener threw on the repair's change set as well): both
   *   errors, the listener's first.
   */
  applyUpdate(update: Uint8Array, origin: TransactionOrigin, options?: ApplyUpdateOptions): void;
  /**
   * Does what `applyUpdate` does, with the same outcome and errors, but in three browser tasks:
   * the depth and shape scan; the Yjs apply and version check; the reference repair,
   * awaiting `options.yieldToBrowser` between them. Writes and other updates throw while it is
   * pending, and `read()` may show the board before its repair. After `destroy()` no further
   * step runs. Optional: a store that cannot split the apply leaves it out.
   *
   * @param update - Update bytes, Yjs update format v1.
   * @param origin - Where the update is attributed to.
   * @param options - How it is applied, and how to yield between the steps.
   * @returns Resolves once the update is applied and repaired; rejects as `applyUpdate` throws.
   */
  applyUpdateInSteps?(
    update: Uint8Array,
    origin: TransactionOrigin,
    options: ApplyUpdateInStepsOptions,
  ): Promise<void>;
  /** Releases the document and every listener; the store cannot be used afterwards. */
  destroy(): void;
}
