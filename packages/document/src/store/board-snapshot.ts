import type { Board, Page, PageId, TokenTable } from '@canvas/schema';

import type { DecodeIssue } from '../codec/decode-issue.js';

/**
 * An immutable view of the whole board, as the schema's `Board` value plus what could not be
 * read. Built from the Yjs types on the first `read()` after a change and cached until the next
 * one; unchanged objects are the same (deep-frozen) values from one snapshot to the next, so a
 * consumer can compare objects by identity to find what changed.
 */
export interface BoardSnapshot extends Board {
  /**
   * Entries of the object map that are not readable objects (an unknown type from a newer
   * peer, a missing field): left out of `objects` and reported here, never thrown. Also each
   * member of a path's vector network that the read hid from a path it shows (`hidden-segment`,
   * `stray-vertex`: a merge or an undo left it breaking the network rules).
   * Stored parent cycles are shown broken and reported as `parent-cycle`.
   * `isHiddenMemberIssue` and `isParentCycleIssue` distinguish these from unreadable entries.
   * Sorted by key, then code.
   */
  readonly issues: readonly DecodeIssue[];
  /**
   * The board's live pages, inserted in page order (by `order`, then
   * id): the virtual default page alone while the board stores none. Never empty.
   */
  readonly pages: ReadonlyMap<PageId, Page>;
  /**
   * The board's colour token table: its custom tokens and edited
   * built-ins, by id, sorted; empty while the board has none. A store's snapshot always has it.
   */
  readonly tokens?: TokenTable;
}
