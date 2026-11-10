import type * as Y from 'yjs';

import type { ObjectId } from '@canvas/schema';

import { DOCUMENT_META_KEY, isReadableMeta, META_MAP_NAME } from '../meta/document-meta.js';
import { DocumentVersionError } from '../meta/document-version-error.js';
import { isObjectEntry } from '../meta/object-entry.js';
import { stampDocument } from '../meta/stamp-document.js';
import { addStampWriters } from '../meta/stamp-writers.js';

/**
 * Keeps a store's document versioned. Each store writes the document's metadata
 * (a stamp) before its first write to the objects, in the same transaction, so the stamp has a
 * lower Yjs clock than every object that client creates; Yjs integrates each client's items in
 * clock order, so any peer that holds an object a client created also holds that client's
 * stamp. After each update the guard checks, for every object entry the update created or
 * replaced, that the entry's writer (its Yjs client id) left a stamp: an item from that client in
 * the metadata key's item chain, deleted or not. A writer from before never stamps, so
 * its objects are refused however many other writers stamped. Package-internal.
 *
 * Why per writer, and why deleted stamps count: every writer stamps the same key, and Yjs keeps
 * one of concurrent stamps (by client id), deleting the others where they merge. A peer can pass
 * on its delete set without the winning stamp (a relay forwarding a peer's sync reply), so a
 * reader can hold a writer's stamp only as a deleted item, or no current stamp at all, for a
 * while. The item chain keeps every stamp's id either way.
 */
export class DocumentVersionGuard {
  readonly #doc: Y.Doc;
  readonly #meta: Y.Map<unknown>;
  readonly #objects: Y.Map<unknown>;
  /** Writers (Yjs client ids) known to have stamped the document. */
  readonly #stampedWriters = new Set<number>();
  /** The Yjs client id this store last stamped as; Yjs may change a document's client id. */
  #stampedClientId: number | undefined;
  #error: DocumentVersionError | undefined;

  /**
   * Guards one document.
   *
   * @param doc - The store's document.
   * @param objects - Its object map.
   */
  constructor(doc: Y.Doc, objects: Y.Map<unknown>) {
    this.#doc = doc;
    this.#meta = doc.getMap<unknown>(META_MAP_NAME);
    this.#objects = objects;
  }

  /**
   * The error that made the store refuse writes, if an update left it holding a document this
   * build cannot read.
   *
   * @returns The error, or `undefined`.
   */
  get error(): DocumentVersionError | undefined {
    return this.#error;
  }

  /**
   * Writes the metadata before the store's first write to its objects, and again whenever the
   * document's Yjs client id changed since (Yjs picks a new one when it finds another client
   * using it): the check is per client id, so each id a store writes objects under needs its own
   * stamp. Call inside the writing transaction, right before any write.
   */
  stampBeforeWrite(): void {
    if (this.#stampedClientId === this.#doc.clientID) return;
    stampDocument(this.#doc);
    this.#stampedClientId = this.#doc.clientID;
  }

  /**
   * Checks the document after an update: its current metadata, when it has one, is readable,
   * and every object entry the update created or replaced was written by a writer that stamped.
   * Every unstamped writer the update brought is named in one error.
   *
   * @param changed - The object ids the update named (created, updated or deleted).
   * @throws {DocumentVersionError} When not; the error is kept in {@link error}.
   */
  check(changed: ReadonlySet<ObjectId>): void {
    const stored = this.#meta.get(DOCUMENT_META_KEY);
    if (stored !== undefined && !isReadableMeta(stored)) {
      this.#fail(new DocumentVersionError('unreadable-version', stored));
    }
    const unstamped = new Set<number>();
    for (const id of changed) {
      const writer = this.#writerOf(id);
      if (writer !== undefined && !this.#hasStampedWriter(writer)) unstamped.add(writer);
    }
    if (unstamped.size > 0) {
      this.#fail(new DocumentVersionError('unversioned', stored, [...unstamped]));
    }
  }

  /**
   * Finds who created an object entry: the Yjs client id of its current item, whatever it holds
   * (`isObjectEntry`, which the relay's stamp check shares).
   *
   * @param id - The object id.
   * @returns The client id, or `undefined` when the entry is gone.
   */
  #writerOf(id: ObjectId): number | undefined {
    const item = this.#objects._map.get(id);
    if (item === undefined) return undefined;
    const isEntry = isObjectEntry({ isUnderObjects: true, key: id, isDeleted: item.deleted });
    return isEntry ? item.id.client : undefined;
  }

  /**
   * Tells whether a writer left a stamp: an item of theirs in the metadata key's item chain.
   *
   * @param writer - The Yjs client id.
   * @returns `true` when it stamped.
   */
  #hasStampedWriter(writer: number): boolean {
    if (this.#stampedWriters.has(writer)) return true;
    addStampWriters(this.#meta, this.#stampedWriters);
    return this.#stampedWriters.has(writer);
  }

  /**
   * Keeps an error and throws it.
   *
   * @param error - The error.
   * @throws {DocumentVersionError} Always.
   */
  #fail(error: DocumentVersionError): never {
    this.#error = error;
    throw error;
  }
}
