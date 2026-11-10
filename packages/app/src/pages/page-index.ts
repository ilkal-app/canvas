import type { ChangeSet, DocumentStore } from '@canvas/document';
import { firstPageIdOf, type BoardObject, type ObjectId, type PageId } from '@canvas/schema';

/** How one object's page changed in a change set: before and after, `undefined` for none. */
export interface PageMove {
  /** The page it was shown on, or `undefined` when it was not on the board. */
  readonly before: PageId | undefined;
  /** The page it is shown on now, or `undefined` when it is gone. */
  readonly after: PageId | undefined;
}

/**
 * The page every object is shown on (the engine's page index): a root object's own page
 * when live, else the first page, and a child its root ancestor's. Kept incrementally from change
 * sets: a changed object is walked to its root (its depth), and when its page changes its subtree
 * follows; a change of the pages rebuilds the index (rare). Main thread.
 */
export class PageIndex {
  readonly #store: DocumentStore;
  #pageById = new Map<ObjectId, PageId>();

  /**
   * Indexes the board as it is.
   *
   * @param store - The whole document.
   */
  constructor(store: DocumentStore) {
    this.#store = store;
    this.#rebuild();
  }

  /**
   * The page an object is shown on.
   *
   * @param id - The object.
   * @returns The page, or `undefined` for an object not on the board.
   */
  pageOf(id: ObjectId): PageId | undefined {
    return this.#pageById.get(id);
  }

  /**
   * The objects on a page. Cost: the board.
   *
   * @param pageId - The page.
   * @returns Their ids, in no particular order.
   */
  idsOn(pageId: PageId): ObjectId[] {
    const ids: ObjectId[] = [];
    for (const [id, page] of this.#pageById) if (page === pageId) ids.push(id);
    return ids;
  }

  /**
   * Follows one change set of the document.
   *
   * @param changes - The change set.
   * @returns Every object whose page changed or that came or went, with its page before and
   *   after (descendants that followed their parent included).
   */
  apply(changes: ChangeSet): Map<ObjectId, PageMove> {
    if (changes.pages !== undefined) return this.#rebuildWithMoves();
    const moves = new Map<ObjectId, PageMove>();
    for (const id of changes.deleted) {
      const before = this.#pageById.get(id);
      this.#pageById.delete(id);
      moves.set(id, { before, after: undefined });
    }
    const first = firstPageIdOf({ objects: new Map(), pages: this.#store.readPages() });
    const known = new Map<ObjectId, PageId | undefined>();
    const created = new Set(changes.created);
    for (const id of [...changes.created, ...changes.updated]) {
      const before = this.#pageById.get(id);
      const after = this.#shownPage(id, first, known);
      if (before === after && !created.has(id)) continue;
      this.#follow(id, before, after, moves, first, known);
    }
    return moves;
  }

  /**
   * Records an object's new page, and its subtree's when it changed.
   *
   * @param id - The object.
   * @param before - Its page before.
   * @param after - Its page now.
   * @param moves - Where moves go.
   * @param first - The first page.
   * @param known - Pages worked out in this pass.
   */
  #follow(
    id: ObjectId,
    before: PageId | undefined,
    after: PageId | undefined,
    moves: Map<ObjectId, PageMove>,
    first: PageId,
    known: Map<ObjectId, PageId | undefined>,
  ): void {
    if (after === undefined) this.#pageById.delete(id);
    else this.#pageById.set(id, after);
    // A move already recorded keeps its first page, even "none" for an object just created.
    const recorded = moves.get(id);
    moves.set(id, { before: recorded === undefined ? before : recorded.before, after });
    if (before === after) return;
    for (const child of this.#store.references.childrenOf(id)) {
      const was = this.#pageById.get(child);
      const now = this.#shownPage(child, first, known);
      if (was !== now) this.#follow(child, was, now, moves, first, known);
    }
  }

  /**
   * The page an object is shown on, walking to its root.
   *
   * @param id - The object.
   * @param first - The first page.
   * @param known - Pages worked out in this pass, by id.
   * @returns The page, or `undefined` when the object is not on the board.
   */
  #shownPage(
    id: ObjectId,
    first: PageId,
    known: Map<ObjectId, PageId | undefined>,
  ): PageId | undefined {
    if (known.has(id)) return known.get(id);
    const object = this.#store.get(id);
    let page: PageId | undefined;
    if (object !== undefined) page = this.#rootPage(object, first);
    known.set(id, page);
    return page;
  }

  /**
   * The page of an object's root ancestor, a page that is not live (or a broken chain) shown as
   * the first.
   *
   * @param object - The object.
   * @param first - The first page.
   * @returns The page.
   */
  #rootPage(object: BoardObject, first: PageId): PageId {
    const pages = this.#store.readPages();
    let current = object;
    const walked = new Set<ObjectId>();
    while (current.parentId !== null) {
      if (walked.has(current.id)) return first;
      walked.add(current.id);
      const parent = this.#store.get(current.parentId);
      if (parent === undefined) return first;
      current = parent;
    }
    const pageId = current.pageId ?? first;
    return pages.has(pageId) ? pageId : first;
  }

  /** Indexes every object afresh. */
  #rebuild(): void {
    const first = firstPageIdOf({ objects: new Map(), pages: this.#store.readPages() });
    const known = new Map<ObjectId, PageId | undefined>();
    const next = new Map<ObjectId, PageId>();
    for (const id of this.#store.read().objects.keys()) {
      const page = this.#shownPage(id, first, known);
      if (page !== undefined) next.set(id, page);
    }
    this.#pageById = next;
  }

  /**
   * Rebuilds the index, reporting every object whose page changed.
   *
   * @returns The moves.
   */
  #rebuildWithMoves(): Map<ObjectId, PageMove> {
    const previous = this.#pageById;
    this.#rebuild();
    const moves = new Map<ObjectId, PageMove>();
    for (const [id, before] of previous) {
      const after = this.#pageById.get(id);
      if (before !== after) moves.set(id, { before, after });
    }
    for (const [id, after] of this.#pageById) {
      if (!previous.has(id)) moves.set(id, { before: undefined, after });
    }
    return moves;
  }
}
