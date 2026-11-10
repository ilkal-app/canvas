import * as Y from 'yjs';

import {
  boardTimerSchema,
  type BoardObject,
  type BoardTimer,
  type ObjectId,
  type Page,
  type PageId,
  type Segment,
  type TextStyle,
  type StyleId,
  type TokenId,
  type TokenTable,
  type Vertex,
} from '@canvas/schema';

import { fromYjs, toYjs, writeObject } from '../codec/object-codec.js';
import { storedTypeOf } from '../codec/object-layout.js';
import type { TextStylePatch } from '../codec/style-attributes.js';
import { writeStickyAuthors } from '../facilitation/sticky-authors-map.js';
import { BOARD_TIMER_KEY, writeBoardTimer } from '../facilitation/timer-map.js';
import { META_MAP_NAME } from '../meta/document-meta.js';
import {
  RESTORE_MARKER_KEY,
  restoreMarkerSchema,
  type RestoreMarker,
} from '../meta/restore-marker.js';
import type { TransactionOrigin } from '../origin/transaction-origin.js';
import { firstPageIn, readPages } from '../pages/page-map.js';
import { erasePage, writePage, type PageCreation } from '../pages/page-writes.js';
import {
  eraseStyle,
  readStyles,
  writeStyle,
  type StyleCreation,
  type StyleKind,
  type StyleTable,
  type StyleWrite,
} from '../styles/style-map.js';
import { readTokens } from '../tokens/token-map.js';
import {
  eraseToken,
  writeToken,
  type TokenCreation,
  type TokenWrite,
} from '../tokens/token-writes.js';

import type { DocumentTransaction, ObjectPatch } from './document-store.js';
import { DocumentWriteError } from './document-write-error.js';
import * as networkEdits from './network-edits.js';
import { parseObject, type StoredFields } from './object-validation.js';
import { withPlacedPage } from './placed-page.js';
import type { StoreSide } from './side-maps.js';
import type { StyleSources } from './style-tables.js';
import * as textEdits from './text-edits.js';

/** The fields of the placement group, which a write stores whole (`codec/object-layout.ts`). */
const PLACEMENT_FIELDS = ['parentId', 'pageId', 'x', 'y', 'rotation'] as const;

/**
 * What a write to an object's entry is judged against (`validateObject`): the object as stored
 * when the entry can be read; for an entry that cannot be read, only its stored `z`, so a write
 * keeping a `z` the key rule rejects is not refused for it; nothing for a new entry.
 *
 * @param id - The object's id.
 * @param existing - The entry under that id, if any.
 * @returns The stored fields, or `undefined` for a new object.
 */
function storedFieldsOf(id: ObjectId, existing: unknown): StoredFields | undefined {
  if (!(existing instanceof Y.Map)) return undefined;
  const decoded = fromYjs(id, existing);
  return 'object' in decoded ? decoded.object : { z: (existing as Y.Map<unknown>).get('z') };
}

/** An object's map together with the object as it is now. */
interface Entry {
  /** The object's map. */
  readonly map: Y.Map<unknown>;
  /** The object, decoded from the map. */
  readonly object: BoardObject;
}

/**
 * The {@link DocumentTransaction} of `YjsDocumentStore`: the typed, validated write surface of
 * one Yjs transaction over the document's object map. It works only while its transaction runs.
 */
export class YjsTransaction implements DocumentTransaction {
  readonly origin: TransactionOrigin;
  readonly #objects: Y.Map<unknown>;
  readonly #pages: Y.Map<unknown>;
  readonly #tokens: Y.Map<unknown>;
  readonly #facilitation: Y.Map<unknown>;
  readonly #styles: StyleSources;
  readonly #beforeWrite: () => void;
  readonly #placementBase: (current: BoardObject) => BoardObject;
  readonly #isCertified: (object: BoardObject) => boolean;
  readonly #before: (id: ObjectId) => BoardObject | undefined;
  #isOpen = true;

  /**
   * Creates the write surface of one transaction.
   *
   * @param objects - The document's object map.
   * @param side - The document's pages map (`pages/page-map.ts`), colour tokens map
   *   (`tokens/token-map.ts`) and named style maps (`styles/style-map.ts`).
   * @param origin - The validated origin of the transaction.
   * @param beforeWrite - Called right before each write to the objects (the store stamps the
   *   document's metadata on its first).
   * @param placementBase - The object a patch of its placement starts from (the store's view of
   *   a parent cycle it shows broken), given the stored object.
   * @param before - An object as of the last completed transaction (the store's decoded view).
   * @param isCertified - Whether an object written is one the open run validated already
   *   (`StoreRun.certify`).
   */
  constructor(
    objects: Y.Map<unknown>,
    side: StoreSide,
    origin: TransactionOrigin,
    beforeWrite: () => void,
    placementBase: (current: BoardObject) => BoardObject,
    before: (id: ObjectId) => BoardObject | undefined,
    isCertified: (object: BoardObject) => boolean,
  ) {
    this.#objects = objects;
    this.#pages = side.pages;
    this.#tokens = side.tokens;
    this.#facilitation = side.facilitation;
    this.#styles = side.styles.sources;
    this.#before = before;
    this.origin = origin;
    this.#beforeWrite = beforeWrite;
    this.#placementBase = placementBase;
    this.#isCertified = isCertified;
  }

  /** Ends the transaction: every later call throws. */
  close(): void {
    this.#isOpen = false;
  }

  /** @inheritdoc */
  markRestore(marker: RestoreMarker): void {
    this.#checkOpen();
    const value = restoreMarkerSchema.parse(marker);
    this.#beforeWrite();
    this.#objects.doc?.getMap(META_MAP_NAME).set(RESTORE_MARKER_KEY, value);
  }

  /**
   * Throws unless the transaction is still running.
   *
   * @throws {Error} When the transaction has ended.
   */
  #checkOpen(): void {
    if (!this.#isOpen) throw new Error('The transaction has ended; start a new one');
  }

  /**
   * Looks up an object's map and decodes it.
   *
   * @param id - The object id.
   * @returns The entry.
   * @throws {RangeError} When there is no readable object with that id.
   */
  #entry(id: ObjectId): Entry {
    this.#checkOpen();
    const map = this.#objects.get(id);
    const decoded = fromYjs(id, map);
    if (!(map instanceof Y.Map) || !('object' in decoded)) {
      throw new RangeError(`There is no readable object "${id}"`);
    }
    return { map: map as Y.Map<unknown>, object: decoded.object };
  }

  /**
   * Looks up an object to edit in place, after the store's pre-write hook ran.
   *
   * @param id - The object id.
   * @returns The entry.
   * @throws {RangeError} When there is no readable object with that id.
   */
  #writableEntry(id: ObjectId): Entry {
    const entry = this.#entry(id);
    this.#beforeWrite();
    return entry;
  }

  /**
   * Looks up a path to edit.
   *
   * @param id - The path's id.
   * @returns The path and its map.
   * @throws {RangeError} When there is no path with that id.
   */
  #path(id: ObjectId): networkEdits.PathTarget {
    const { map, object } = this.#writableEntry(id);
    if (object.type !== 'path') throw new RangeError(`Object "${id}" is not a path`);
    return networkEdits.pathTargetOf(map, object);
  }

  /** @inheritdoc */
  get(id: ObjectId): BoardObject | undefined {
    this.#checkOpen();
    const decoded = fromYjs(id, this.#objects.get(id));
    return 'object' in decoded ? decoded.object : undefined;
  }

  /** @inheritdoc */
  pages(): ReadonlyMap<PageId, Page> {
    this.#checkOpen();
    return readPages(this.#pages);
  }

  /** @inheritdoc */
  setPage(page: Page, creation: PageCreation): void {
    this.#checkOpen();
    this.#beforeWrite();
    writePage(this.#pages, page, creation);
  }

  /** @inheritdoc */
  deletePage(pageId: PageId): boolean {
    this.#checkOpen();
    this.#beforeWrite();
    return erasePage(this.#pages, pageId);
  }

  /** @inheritdoc */
  tokens(): TokenTable {
    this.#checkOpen();
    return readTokens(this.#tokens);
  }

  /** @inheritdoc */
  setToken(token: TokenWrite, creation: TokenCreation): void {
    this.#checkOpen();
    this.#beforeWrite();
    writeToken(this.#tokens, token, creation);
  }

  /** @inheritdoc */
  deleteToken(tokenId: TokenId): boolean {
    this.#checkOpen();
    this.#beforeWrite();
    return eraseToken(this.#tokens, tokenId);
  }

  /** @inheritdoc */
  setBoardTimer(timer: BoardTimer | undefined): void {
    this.#checkOpen();
    const issues =
      timer === undefined ? [] : (boardTimerSchema.safeParse(timer).error?.issues ?? []);
    if (issues.length > 0) throw new DocumentWriteError(BOARD_TIMER_KEY, issues);
    this.#beforeWrite();
    writeBoardTimer(this.#facilitation, timer);
  }

  /** @inheritdoc */
  setStickyAuthors(isShown: boolean): void {
    this.#checkOpen();
    this.#beforeWrite();
    writeStickyAuthors(this.#facilitation, isShown);
  }

  /** @inheritdoc */
  namedStyles<Kind extends StyleKind>(kind: Kind): StyleTable<Kind> {
    this.#checkOpen();
    return readStyles(this.#styles[kind], kind) as StyleTable<Kind>;
  }

  /** @inheritdoc */
  setNamedStyle<Kind extends StyleKind>(
    kind: Kind,
    style: StyleWrite<Kind>,
    creation: StyleCreation,
  ): void {
    this.#checkOpen();
    this.#beforeWrite();
    writeStyle(this.#styles[kind], kind, style, creation);
  }

  /** @inheritdoc */
  deleteNamedStyle(kind: StyleKind, styleId: StyleId): boolean {
    this.#checkOpen();
    this.#beforeWrite();
    return eraseStyle(this.#styles[kind], styleId);
  }

  /**
   * An object with its page settled (`placed-page.ts`), as of now in this transaction.
   *
   * @param object - The object to write.
   * @param existing - The object as stored, if readable.
   * @returns The object with its `pageId`.
   */
  #placed(object: BoardObject, existing: BoardObject | undefined): BoardObject {
    return withPlacedPage(object, existing, {
      get: (id) => this.get(id),
      before: this.#before,
      firstPageId: () => firstPageIn(readPages(this.#pages)),
    });
  }

  /** @inheritdoc */
  setObject(object: BoardObject): void {
    this.#checkOpen();
    const existing: unknown = this.#objects.get(object.id);
    const stored = storedFieldsOf(object.id, existing);
    const placed = this.#placed(object, this.get(object.id));
    // A create the open run's plan already validated whole, its page unchanged.
    const isCertified = existing === undefined && placed === object && this.#isCertified(object);
    const parsed = isCertified ? placed : parseObject(placed, stored);
    this.#beforeWrite();
    if (existing instanceof Y.Map && storedTypeOf(existing as Y.Map<unknown>) === parsed.type) {
      writeObject(existing as Y.Map<unknown>, parsed);
    } else {
      this.#objects.set(parsed.id, toYjs(parsed));
    }
  }

  /** @inheritdoc */
  patchObject(id: ObjectId, patch: ObjectPatch): void {
    const { map, object } = this.#entry(id);
    const fixed = patch as Readonly<Record<string, unknown>>;
    if (('id' in fixed && fixed.id !== id) || ('type' in fixed && fixed.type !== object.type)) {
      throw new RangeError(`A patch cannot change the id or type of "${id}"`);
    }
    const isPlacementPatch = PLACEMENT_FIELDS.some((field) => field in fixed);
    const base = isPlacementPatch ? this.#placementBase(object) : object;
    const merged = { ...base, ...patch } as BoardObject;
    const parsed = parseObject(isPlacementPatch ? this.#placed(merged, object) : merged, object);
    // Fields the patch gives as `undefined` are removed explicitly: a refused stored value of one
    // is not carried through (`optional-style-tolerance.ts`).
    const removed = new Set(Object.keys(fixed).filter((key) => fixed[key] === undefined));
    this.#beforeWrite();
    writeObject(map, parsed, removed);
  }

  /** @inheritdoc */
  deleteObject(id: ObjectId): boolean {
    this.#checkOpen();
    if (!this.#objects.has(id)) return false;
    this.#beforeWrite();
    this.#objects.delete(id);
    return true;
  }

  /** @inheritdoc */
  insertText(id: ObjectId, index: number, text: string, style: TextStyle): void {
    const { map, object } = this.#writableEntry(id);
    textEdits.insertText(textEdits.findTextTarget(map, object), index, text, style);
  }

  /** @inheritdoc */
  deleteText(id: ObjectId, index: number, length: number): void {
    const { map, object } = this.#writableEntry(id);
    textEdits.deleteText(textEdits.findTextTarget(map, object), index, length);
  }

  /** @inheritdoc */
  formatText(id: ObjectId, index: number, length: number, patch: TextStylePatch): void {
    const { map, object } = this.#writableEntry(id);
    textEdits.formatText(textEdits.findTextTarget(map, object), index, length, patch);
  }

  /** @inheritdoc */
  setVertex(id: ObjectId, vertex: Vertex): void {
    networkEdits.setVertex(this.#path(id), vertex);
  }

  /** @inheritdoc */
  deleteVertex(id: ObjectId, vertexId: string): boolean {
    return networkEdits.deleteVertex(this.#path(id), vertexId);
  }

  /** @inheritdoc */
  setSegment(id: ObjectId, segment: Segment): void {
    networkEdits.setSegment(this.#path(id), segment);
  }

  /** @inheritdoc */
  deleteSegment(id: ObjectId, segmentId: string): boolean {
    return networkEdits.deleteSegment(this.#path(id), segmentId);
  }
}
