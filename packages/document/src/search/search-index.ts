import { shownPageIdOf, type BoardObject, type ObjectId, type PageId } from '@canvas/schema';

import type { BoardSnapshot, ChangeSet } from '../store/document-store.js';

import { foldForSearch, matchesFoldedQuery, searchWordsOf } from './fold-and-match.js';
import { searchableTextOf, type SearchGroup } from './searchable-text.js';

/** One board search result. */
export interface SearchHit {
  /** The object found. */
  readonly id: ObjectId;
  /** Its group. */
  readonly group: SearchGroup;
  /** Its text, as written. */
  readonly text: string;
  /** The page it is on (its root ancestor's). */
  readonly pageId: PageId;
  /** The name of the nearest frame it is in, if any. */
  readonly sectionName: string | undefined;
}

/** How {@link SearchIndex.search} narrows its results. */
export interface SearchOptions {
  /** Only results on this page; every page if absent. */
  readonly pageId?: PageId;
  /** At most this many results; {@link DEFAULT_SEARCH_LIMIT} if absent. */
  readonly limit?: number;
}

/** How many results a search returns at most unless asked otherwise. */
export const DEFAULT_SEARCH_LIMIT = 200;

/** The groups in the order results show them. */
const GROUP_ORDER: readonly SearchGroup[] = ['stickies', 'text', 'sections'];

/** An indexed object: its text, folded once, with its words. */
interface Entry {
  readonly group: SearchGroup;
  readonly text: string;
  readonly folded: string;
  readonly words: readonly string[];
}

/**
 * An entry for an object, if search reads it.
 *
 * @param object - The object.
 * @returns Its entry, or undefined.
 */
function entryOf(object: BoardObject): Entry | undefined {
  const searchable = searchableTextOf(object);
  if (searchable === undefined) return undefined;
  const folded = foldForSearch(searchable.text);
  return { ...searchable, folded, words: searchWordsOf(folded) };
}

/**
 * The board's searchable text: built once from a snapshot, then kept current from the
 * store's change sets (`apply` reads only the ids a change set names), so a query never rescans
 * the board's objects. Results come in group order (stickies, text, sections), each group in the
 * board's order, with the page and the section (nearest frame) worked out for each result from
 * the latest snapshot. Never mutates a snapshot or a change set.
 */
export class SearchIndex {
  readonly #entries = new Map<ObjectId, Entry>();
  #board: BoardSnapshot;

  /**
   * Indexes a board.
   *
   * @param board - The board.
   */
  constructor(board: BoardSnapshot) {
    this.#board = board;
    for (const [id, object] of board.objects) {
      const entry = entryOf(object);
      if (entry !== undefined) this.#entries.set(id, entry);
    }
  }

  /**
   * Follows a change set: the ids it creates or updates are read again from the board after it,
   * those it deletes dropped; no other object is read.
   *
   * @param changes - The change set.
   * @param board - The board after it.
   */
  apply(changes: ChangeSet, board: BoardSnapshot): void {
    this.#board = board;
    for (const id of changes.deleted) this.#entries.delete(id);
    for (const id of [...changes.created, ...changes.updated]) {
      const object = board.objects.get(id);
      const entry = object === undefined ? undefined : entryOf(object);
      if (entry === undefined) this.#entries.delete(id);
      else this.#entries.set(id, entry);
    }
  }

  /**
   * The objects whose text matches a query (`matchesQuery`'s rules).
   *
   * @param query - The query.
   * @param options - A page to search and a limit.
   * @returns The results, in group order.
   */
  search(query: string, options: SearchOptions): readonly SearchHit[] {
    const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;
    const queryWords = searchWordsOf(foldForSearch(query));
    if (limit <= 0 || queryWords.length === 0) return [];
    const byGroup: Record<SearchGroup, SearchHit[]> = { stickies: [], text: [], sections: [] };
    for (const [id, entry] of this.#entries) {
      if (!matchesFoldedQuery(entry.folded, entry.words, queryWords)) continue;
      const hit = this.#hitOf(id, entry);
      if (hit === undefined) continue;
      if (options.pageId !== undefined && hit.pageId !== options.pageId) continue;
      byGroup[entry.group].push(hit);
    }
    return GROUP_ORDER.flatMap((group) => byGroup[group]).slice(0, limit);
  }

  /**
   * A matching object's result, its page and section read from the latest snapshot.
   *
   * @param id - The object.
   * @param entry - Its entry.
   * @returns The result, or undefined if the object is gone.
   */
  #hitOf(id: ObjectId, entry: Entry): SearchHit | undefined {
    const board = this.#board;
    const object = board.objects.get(id);
    if (object === undefined) return undefined;
    return {
      id,
      group: entry.group,
      text: entry.text,
      pageId: shownPageIdOf(board, object),
      sectionName: sectionNameOf(board, object),
    };
  }
}

/**
 * The name of the nearest frame an object is in (its section), cycle-safe.
 *
 * @param board - The board.
 * @param object - The object.
 * @returns The frame's name, or undefined outside any frame.
 */
function sectionNameOf(board: BoardSnapshot, object: BoardObject): string | undefined {
  const seen = new Set<ObjectId>([object.id]);
  let parentId = object.parentId;
  while (parentId !== null && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = board.objects.get(parentId);
    if (parent === undefined) return undefined;
    if (parent.type === 'frame') return parent.name;
    parentId = parent.parentId;
  }
  return undefined;
}
