import type {
  BoardObject,
  BoardTimer,
  ObjectId,
  Page,
  PageId,
  Segment,
  StyleId,
  TextStyle,
  TokenId,
  TokenTable,
  Vertex,
} from '@canvas/schema';

import type { TextStylePatch } from '../codec/style-attributes.js';
import type { RestoreMarker } from '../meta/restore-marker.js';
import type { TransactionOrigin } from '../origin/transaction-origin.js';
import type { PageCreation } from '../pages/page-writes.js';
import type { DocumentTransaction, ObjectPatch } from '../store/document-store.js';
import type { StyleCreation, StyleKind, StyleTable, StyleWrite } from '../styles/style-map.js';
import type { TokenCreation, TokenWrite } from '../tokens/token-writes.js';

import { OBJECT_WRITES } from './write-budget.js';

/** What decides one command's `updatedAt` stamps, across all its transactions. */
export interface CommandStamps {
  /** Each written object's `updatedAt` before the command first wrote it; `undefined` if new. */
  readonly before: Map<ObjectId, number | undefined>;
  /** The objects whose reference fields the command wrote (see {@link REFERENCE_FIELDS}). */
  readonly referenceWritten: Set<ObjectId>;
}

/**
 * A command's stamp record, empty: what its first transaction starts with.
 *
 * @returns The record.
 */
export function commandStamps(): CommandStamps {
  return { before: new Map(), referenceWritten: new Set() };
}

/**
 * The fields of an object that the reference repair also writes (`repair/reference-repair.ts`):
 * where it sits (`parentId`, `x`, `y`, `rotation`, one group), its stacking key, a connector's
 * ends and a comment's anchor.
 */
const REFERENCE_FIELDS: ReadonlySet<string> = new Set([
  'parentId',
  'pageId',
  'x',
  'y',
  'rotation',
  'z',
  'from',
  'to',
  'anchor',
]);

/**
 * Tells whether a whole-object write changes a reference field.
 *
 * @param before - The object as it was.
 * @param after - The object as written.
 * @returns `true` when a reference field's value differs.
 */
function isReferenceChanged(before: BoardObject, after: BoardObject): boolean {
  const was = before as unknown as Readonly<Record<string, unknown>>;
  const is = after as unknown as Readonly<Record<string, unknown>>;
  return [...REFERENCE_FIELDS].some(
    (field) => JSON.stringify(was[field]) !== JSON.stringify(is[field]),
  );
}

/**
 * The transaction a command's `apply` writes through: it passes every call to the store's
 * transaction and remembers which objects were written, so `runCommand` can stamp their
 * `updatedAt` with the command's time once `apply` returns, in the same transaction. Stamping
 * in one place means every command, including ones that only reorder or restyle text, keeps
 * `updatedAt` honest without doing it itself.
 */
export class StampingTransaction implements DocumentTransaction {
  readonly #inner: DocumentTransaction;
  readonly #written = new Set<ObjectId>();
  /** Each written object's `updatedAt` before its first write, `undefined` for a new object. */
  readonly #stampBefore: CommandStamps['before'];
  /** The objects whose reference fields were written (see {@link REFERENCE_FIELDS}). */
  readonly #referenceWritten: CommandStamps['referenceWritten'];
  /**
   * Each object's `updatedAt` as its last whole-object write gave it, so `stamp` need
   * not decode it again; a patch forgets it, and an object missing here is read.
   */
  readonly #knownStamp = new Map<ObjectId, number>();
  /** Deletions and side-table writes made, each one planned write (`write-budget.ts`). */
  #singleWrites = 0;

  /**
   * Wraps a transaction.
   *
   * @param inner - The store's transaction.
   * @param stamps - What decides the command's stamps, shared by the transactions of one command
   *   written in parts, so an object a later part writes again is stamped as one
   *   transaction would stamp it.
   */
  constructor(inner: DocumentTransaction, stamps: CommandStamps = commandStamps()) {
    this.#inner = inner;
    this.#stampBefore = stamps.before;
    this.#referenceWritten = stamps.referenceWritten;
  }

  /**
   * The planned writes made so far (`write-budget.ts`): two per object written (the
   * object and its stamp), one per deletion or side-table write.
   *
   * @returns The count.
   */
  get plannedWrites(): number {
    return this.#written.size * OBJECT_WRITES + this.#singleWrites;
  }

  /** @inheritdoc */
  get origin(): TransactionOrigin {
    return this.#inner.origin;
  }

  /** @inheritdoc */
  markRestore(marker: RestoreMarker): void {
    this.#singleWrites += 1;
    this.#inner.markRestore(marker);
  }

  /** @inheritdoc */
  get(id: ObjectId): BoardObject | undefined {
    return this.#inner.get(id);
  }

  /** @inheritdoc */
  setObject(object: BoardObject): void {
    const before = this.#noteWrite(object.id);
    if (before !== undefined && isReferenceChanged(before, object)) {
      this.#referenceWritten.add(object.id);
    }
    this.#inner.setObject(object);
    this.#knownStamp.set(object.id, object.updatedAt);
  }

  /** @inheritdoc */
  patchObject(id: ObjectId, patch: ObjectPatch): void {
    this.#noteWrite(id);
    if (Object.keys(patch).some((field) => REFERENCE_FIELDS.has(field))) {
      this.#referenceWritten.add(id);
    }
    this.#inner.patchObject(id, patch);
    const stamped = (patch as { readonly updatedAt?: unknown }).updatedAt;
    if (typeof stamped === 'number') this.#knownStamp.set(id, stamped);
    else this.#knownStamp.delete(id);
  }

  /** @inheritdoc */
  pages(): ReadonlyMap<PageId, Page> {
    return this.#inner.pages();
  }

  /** @inheritdoc */
  setPage(page: Page, creation: PageCreation): void {
    this.#singleWrites += 1;
    this.#inner.setPage(page, creation);
  }

  /** @inheritdoc */
  deletePage(pageId: PageId): boolean {
    this.#singleWrites += 1;
    return this.#inner.deletePage(pageId);
  }

  /** @inheritdoc */
  tokens(): TokenTable {
    return this.#inner.tokens();
  }

  /** @inheritdoc */
  setToken(token: TokenWrite, creation: TokenCreation): void {
    this.#singleWrites += 1;
    this.#inner.setToken(token, creation);
  }

  /** @inheritdoc */
  deleteToken(tokenId: TokenId): boolean {
    this.#singleWrites += 1;
    return this.#inner.deleteToken(tokenId);
  }

  /** @inheritdoc */
  setBoardTimer(timer: BoardTimer | undefined): void {
    this.#singleWrites += 1;
    this.#inner.setBoardTimer(timer);
  }

  /** @inheritdoc */
  setStickyAuthors(isShown: boolean): void {
    this.#singleWrites += 1;
    this.#inner.setStickyAuthors(isShown);
  }

  /** @inheritdoc */
  namedStyles<Kind extends StyleKind>(kind: Kind): StyleTable<Kind> {
    return this.#inner.namedStyles(kind);
  }

  /** @inheritdoc */
  setNamedStyle<Kind extends StyleKind>(
    kind: Kind,
    style: StyleWrite<Kind>,
    creation: StyleCreation,
  ): void {
    this.#singleWrites += 1;
    this.#inner.setNamedStyle(kind, style, creation);
  }

  /** @inheritdoc */
  deleteNamedStyle(kind: StyleKind, styleId: StyleId): boolean {
    this.#singleWrites += 1;
    return this.#inner.deleteNamedStyle(kind, styleId);
  }

  /** @inheritdoc */
  deleteObject(id: ObjectId): boolean {
    this.#singleWrites += 1;
    this.#written.delete(id);
    this.#knownStamp.delete(id);
    return this.#inner.deleteObject(id);
  }

  /** @inheritdoc */
  insertText(id: ObjectId, index: number, text: string, style: TextStyle): void {
    this.#inner.insertText(id, index, text, style);
    this.#written.add(id);
  }

  /** @inheritdoc */
  deleteText(id: ObjectId, index: number, length: number): void {
    this.#inner.deleteText(id, index, length);
    this.#written.add(id);
  }

  /** @inheritdoc */
  formatText(id: ObjectId, index: number, length: number, patch: TextStylePatch): void {
    this.#inner.formatText(id, index, length, patch);
    this.#written.add(id);
  }

  /** @inheritdoc */
  setVertex(id: ObjectId, vertex: Vertex): void {
    this.#inner.setVertex(id, vertex);
    this.#written.add(id);
  }

  /** @inheritdoc */
  deleteVertex(id: ObjectId, vertexId: string): boolean {
    this.#written.add(id);
    return this.#inner.deleteVertex(id, vertexId);
  }

  /** @inheritdoc */
  setSegment(id: ObjectId, segment: Segment): void {
    this.#inner.setSegment(id, segment);
    this.#written.add(id);
  }

  /** @inheritdoc */
  deleteSegment(id: ObjectId, segmentId: string): boolean {
    this.#written.add(id);
    return this.#inner.deleteSegment(id, segmentId);
  }

  /**
   * Sets `updatedAt` on every object written through this transaction that still exists and
   * does not already carry the time. An object whose reference fields the command wrote (where
   * it sits, what its ends or pin attach to) always gets a new value, `max(now, stored + 1)`: the
   * undo history tells a person's write of those fields from the reference repair's, which
   * writes them on every client and never stamps, by that stamp (`history/written-by-others.ts`;
   * Fix round 2), and the store writes a field only when its value changes. A timestamp
   * is always valid, so this cannot fail. Known gap: when the stored stamp is already
   * `Number.MAX_SAFE_INTEGER` (only a peer that skips validation can store it), the clamp writes
   * no new stamp, so the history reads that edit of a reference key as the repair's. The stored
   * stamp of an object whose last write was whole is the one that write gave; only others are
   * read back (a 1,000-object paste decoded every object again here).
   *
   * @param now - The command's time, ms since the Unix epoch.
   */
  stamp(now: number): void {
    for (const id of this.#written) {
      // A whole-object write's stamp is known; anything else is read (a decode).
      const stored = this.#knownStamp.get(id) ?? this.#inner.get(id)?.updatedAt;
      if (stored === undefined) continue;
      const before = this.#stampBefore.get(id);
      const isForced = this.#referenceWritten.has(id) && before !== undefined;
      // Clamped: a peer that skips validation may have stored the largest safe integer.
      const time = isForced ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(now, before + 1)) : now;
      if (stored !== time) this.#inner.patchObject(id, { updatedAt: time });
    }
  }

  /**
   * Notes a write to an object, and its stamp before the first one.
   *
   * @param id - The object.
   * @returns The object before the write, `undefined` when it is new.
   */
  #noteWrite(id: ObjectId): BoardObject | undefined {
    const before = this.#inner.get(id);
    if (!this.#stampBefore.has(id)) this.#stampBefore.set(id, before?.updatedAt);
    this.#written.add(id);
    return before;
  }
}
