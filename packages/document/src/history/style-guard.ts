import * as Y from 'yjs';

import type { StyleId } from '@canvas/schema';

import { parseStyleKey, STYLE_FIELDS, styleKey } from '../styles/style-map.js';

import type { UndoStep } from './field-guard.js';
import { isKeyWrittenByOthers, type WriterScope } from './written-by-others.js';

// For named styles, as `token-guard.ts` is for colour tokens: an undo or redo
// that would remove a style (undoing its creation, redoing its delete) changes nothing when
// another person has since written one of its keys; the step is used up, never partly applied,
// so a rename or a new value by someone else is not lost with the style.

/**
 * The styles a step would remove from one style map: live `.identity` entries among its
 * insertions, or the entries an undo or redo has since re-created them as.
 *
 * @param transaction - The open transaction.
 * @param step - The step.
 * @param styles - One kind's style map.
 * @returns The ids of the styles it would remove.
 */
export function removedStyles(
  transaction: Y.Transaction,
  step: UndoStep,
  styles: Y.Map<unknown>,
): StyleId[] {
  const removed: StyleId[] = [];
  Y.iterateDeletedStructs(transaction, step.insertions, (struct) => {
    if (!(struct instanceof Y.Item) || struct.parent !== styles || struct.parentSub === null)
      return;
    const parsed = parseStyleKey(struct.parentSub);
    if (parsed?.field !== 'identity') return;
    let entry = struct;
    while (entry.redone !== null) {
      const next = Y.getItem(transaction.doc.store, entry.redone);
      if (!(next instanceof Y.Item)) return;
      entry = next;
    }
    if (!entry.deleted) removed.push(parsed.styleId);
  });
  return removed;
}

/**
 * Whether another person has written one of a style's keys since the step.
 *
 * @param styleId - The style.
 * @param styles - Its kind's style map.
 * @param scope - The step's scope.
 * @returns True when the style must be kept.
 */
export function isStyleTouchedSince(
  styleId: StyleId,
  styles: Y.Map<unknown>,
  scope: WriterScope,
): boolean {
  return STYLE_FIELDS.some((field) => {
    const item = styles._map.get(styleKey(styleId, field));
    return item !== undefined && !item.deleted && isKeyWrittenByOthers(item, scope);
  });
}
