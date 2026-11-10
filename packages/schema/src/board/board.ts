import type { TokenEntry, TokenTable } from '../fields/color-tokens.js';
import type {
  EffectStyleEntry,
  EffectStyleTable,
  TextStyleEntry,
  TextStyleTable,
} from '../fields/named-styles.js';
import type { ObjectId } from '../ids/object-id.js';
import type { PageId } from '../ids/page-id.js';
import type { BoardObject } from '../objects/board-object.js';
import type { Page } from '../pages/page.js';

/**
 * A board as a plain value: every object keyed by its id. This is the shape the pure rules,
 * the portable format and tests work on; `@canvas/document` keeps the live board in Yjs and
 * converts at its boundary. Functions in this package never mutate a board: they return a new
 * one that shares unchanged objects with the old.
 */
export interface Board {
  /** Every object on the board, keyed by its id; the order of the map carries no meaning. */
  readonly objects: ReadonlyMap<ObjectId, BoardObject>;
  /**
   * The board's pages, keyed by id; the order of the map carries no
   * meaning (`orderedPagesOf`). Absent or empty: the board has one page, the virtual default
   * page (`DEFAULT_PAGE`).
   */
  readonly pages?: ReadonlyMap<PageId, Page>;
  /**
   * The board's colour token table: its custom tokens and edited
   * built-ins, by id. Absent or empty: the six built-ins at their defaults alone.
   */
  readonly tokens?: TokenTable;
  /** The board's named text styles by id; absent or empty: none. */
  readonly textStyles?: TextStyleTable;
  /** The board's named effect styles by id; absent or empty: none. */
  readonly effectStyles?: EffectStyleTable;
}

/** A board's named style tables' entries, as {@link createBoard} takes them. */
export interface BoardStyles {
  /** The text styles, each with a distinct id. */
  readonly textStyles?: Iterable<TextStyleEntry>;
  /** The effect styles, each with a distinct id. */
  readonly effectStyles?: Iterable<EffectStyleEntry>;
}

/**
 * Creates a board holding the given objects. The objects are not validated; parse them with
 * `boardObjectSchema` first, and check references with `validateBoard`.
 *
 * @param objects - The objects, each with a distinct id.
 * @param pages - The pages, each with a distinct id; none for a board of the default page only.
 * @param tokens - The token table's entries, each with a distinct id; none for the built-ins only.
 * @param styles - The named style tables' entries; none for no styles.
 * @returns A new board keyed by object id.
 * @throws {RangeError} When two objects, two pages, two tokens or two styles of a kind share an id.
 */
export function createBoard(
  objects: Iterable<BoardObject>,
  pages?: Iterable<Page>,
  tokens?: Iterable<TokenEntry>,
  styles: BoardStyles = {},
): Board {
  const byId = new Map<ObjectId, BoardObject>();
  for (const object of objects) {
    if (byId.has(object.id)) {
      throw new RangeError(`Duplicate object id "${object.id}"`);
    }
    byId.set(object.id, object);
  }
  const board: { -readonly [Key in keyof Board]: Board[Key] } = { objects: byId };
  if (pages !== undefined) {
    const pagesById = new Map<PageId, Page>();
    for (const page of pages) {
      if (pagesById.has(page.id)) throw new RangeError(`Duplicate page id "${page.id}"`);
      pagesById.set(page.id, page);
    }
    board.pages = pagesById;
  }
  if (tokens !== undefined) {
    const tokensById = new Map<string, TokenEntry>();
    for (const token of tokens) {
      if (tokensById.has(token.id)) throw new RangeError(`Duplicate token id "${token.id}"`);
      tokensById.set(token.id, token);
    }
    board.tokens = tokensById;
  }
  if (styles.textStyles !== undefined) board.textStyles = byStyleId(styles.textStyles, 'text');
  if (styles.effectStyles !== undefined) {
    board.effectStyles = byStyleId(styles.effectStyles, 'effect');
  }
  return board;
}

/**
 * Keys a style table's entries by id.
 *
 * @param entries - The entries.
 * @param kind - Which table, for the error.
 * @returns The table.
 * @throws {RangeError} When two entries share an id.
 */
function byStyleId<Entry extends { readonly id: string }>(
  entries: Iterable<Entry>,
  kind: 'text' | 'effect',
): ReadonlyMap<string, Entry> {
  const byId = new Map<string, Entry>();
  for (const entry of entries) {
    if (byId.has(entry.id)) throw new RangeError(`Duplicate ${kind} style id "${entry.id}"`);
    byId.set(entry.id, entry);
  }
  return byId;
}
