import type { Board } from '../board/board.js';
import { orderedPagesOf } from '../pages/board-pages.js';
import { SCHEMA_VERSION } from '../version/schema-version.js';

import { PORTABLE_BOARD_FORMAT, type PortableBoardJson } from './portable-board.js';

/**
 * Exports a board as a portable JSON document at the current schema version, with its pages in
 * page order (the default page alone for a board that stores none), its colour token
 * table sorted by id when it has one, its named text and effect styles sorted by id
 * when it has them, and its objects
 * sorted by id (UTF-16 code units) so the same board always serialises to the same text. The
 * objects in the result are the board's own objects, not copies: serialise the result, or treat
 * it as read-only.
 *
 * @param board - The board to export; it is not modified.
 * @returns The portable document, ready for `JSON.stringify`.
 */
export function exportBoard(board: Board): PortableBoardJson {
  const objects = [...board.objects.values()].sort((first, second) =>
    first.id < second.id ? -1 : first.id > second.id ? 1 : 0,
  );
  const tokens = [...(board.tokens?.values() ?? [])]
    .sort((first, second) => (first.id < second.id ? -1 : first.id > second.id ? 1 : 0))
    .map((token) => {
      const identity = {
        builtin: token.builtin,
        createdBy: token.createdBy,
        createdAt: token.createdAt,
      };
      return { id: token.id, name: token.name, identity, light: token.light, dark: token.dark };
    });
  const textStyles = sortedById(board.textStyles);
  const effectStyles = sortedById(board.effectStyles);
  return {
    format: PORTABLE_BOARD_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    pages: orderedPagesOf(board),
    ...(tokens.length === 0 ? {} : { tokens }),
    ...(textStyles.length === 0 ? {} : { textStyles }),
    ...(effectStyles.length === 0 ? {} : { effectStyles }),
    objects,
  };
}

/**
 * A style table's entries sorted by id (UTF-16 code units).
 *
 * @param table - The table, or undefined.
 * @returns The entries; empty for none.
 */
function sortedById<Entry extends { readonly id: string }>(
  table: ReadonlyMap<string, Entry> | undefined,
): Entry[] {
  return [...(table?.values() ?? [])].sort((first, second) =>
    first.id < second.id ? -1 : first.id > second.id ? 1 : 0,
  );
}
