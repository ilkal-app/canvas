import type { ObjectId } from '@canvas/schema';

import type { LayerRow } from './layer-rows.js';

/** What a key does in the layers tree. */
export type LayerKeyIntent =
  | {
      /** Move keyboard focus to another row. */
      readonly kind: 'focus';
      /** The row's index. */
      readonly index: number;
    }
  | {
      /** Expand or collapse a row. */
      readonly kind: 'expand';
      /** The row. */
      readonly row: LayerRow;
      /** Whether to expand it. */
      readonly isExpanded: boolean;
    }
  | {
      /** Select the focused row (Shift adds it). */
      readonly kind: 'select';
      /** The row. */
      readonly row: LayerRow;
    };

/**
 * The index of a row's parent, scanning up from it (a parent is always above its children): no
 * copies, and O(rows between the two).
 *
 * @param rows - The rows.
 * @param index - The child's index.
 * @param parentId - The child's parent.
 * @returns The parent's index, or -1 at the root.
 */
function parentIndexOf(
  rows: readonly LayerRow[],
  index: number,
  parentId: ObjectId | null,
): number {
  if (parentId === null) return -1;
  for (let at = index - 1; at >= 0; at -= 1) {
    if (rows[at]?.id === parentId) return at;
  }
  return -1;
}

/**
 * What a key press does in the layers tree, following the WAI-ARIA tree pattern: Up and Down
 * move, Home and End jump, Right expands a collapsed row or moves into it, Left collapses an
 * expanded row or moves to its parent, Enter and Space select.
 *
 * @param rows - The rows.
 * @param focusIndex - The focused row's index.
 * @param key - `KeyboardEvent.key`.
 * @returns The intent, or undefined for a key the tree does not take.
 */
export function layerKeyIntent(
  rows: readonly LayerRow[],
  focusIndex: number,
  key: string,
): LayerKeyIntent | undefined {
  const row = rows[focusIndex];
  if (row === undefined) return undefined;
  const last = rows.length - 1;
  switch (key) {
    case 'ArrowDown':
      return { kind: 'focus', index: Math.min(last, focusIndex + 1) };
    case 'ArrowUp':
      return { kind: 'focus', index: Math.max(0, focusIndex - 1) };
    case 'Home':
      return { kind: 'focus', index: 0 };
    case 'End':
      return { kind: 'focus', index: last };
    case 'ArrowRight':
      if (row.hasChildren && !row.isExpanded) return { kind: 'expand', row, isExpanded: true };
      return row.isExpanded ? { kind: 'focus', index: Math.min(last, focusIndex + 1) } : undefined;
    case 'ArrowLeft': {
      if (row.isExpanded) return { kind: 'expand', row, isExpanded: false };
      const parent = parentIndexOf(rows, focusIndex, row.parentId);
      return parent === -1 ? undefined : { kind: 'focus', index: parent };
    }
    case 'Enter':
    case ' ':
      return { kind: 'select', row };
    default:
      return undefined;
  }
}
