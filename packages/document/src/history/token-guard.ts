import * as Y from 'yjs';

import type { TokenId } from '@canvas/schema';

import { parseTokenKey, TOKEN_FIELDS, tokenKey } from '../tokens/token-map.js';

import type { UndoStep } from './field-guard.js';
import { isKeyWrittenByOthers, type WriterScope } from './written-by-others.js';

// For colour tokens, as `page-guard.ts` is for pages: an undo or redo that would
// remove a token (undoing its creation or a built-in's edit, redoing its delete or reset) changes
// nothing when another person has since written one of its keys; the step is used up, never
// partly applied, so a recolour or rename by someone else is not lost with the token.

/**
 * The tokens a step would remove: live `.identity` entries of the tokens map among its
 * insertions, or the entries an undo or redo has since re-created them as.
 *
 * @param transaction - The open transaction.
 * @param step - The step.
 * @param tokens - The tokens map.
 * @returns The ids of the tokens it would remove.
 */
export function removedTokens(
  transaction: Y.Transaction,
  step: UndoStep,
  tokens: Y.Map<unknown>,
): TokenId[] {
  const removed: TokenId[] = [];
  Y.iterateDeletedStructs(transaction, step.insertions, (struct) => {
    if (!(struct instanceof Y.Item) || struct.parent !== tokens || struct.parentSub === null)
      return;
    const parsed = parseTokenKey(struct.parentSub);
    if (parsed?.field !== 'identity') return;
    let entry = struct;
    while (entry.redone !== null) {
      const next = Y.getItem(transaction.doc.store, entry.redone);
      if (!(next instanceof Y.Item)) return;
      entry = next;
    }
    if (!entry.deleted) removed.push(parsed.tokenId);
  });
  return removed;
}

/**
 * Whether another person has written one of a token's keys since the step.
 *
 * @param tokenId - The token.
 * @param tokens - The tokens map.
 * @param scope - The step's scope.
 * @returns True when the token must be kept.
 */
export function isTokenTouchedSince(
  tokenId: TokenId,
  tokens: Y.Map<unknown>,
  scope: WriterScope,
): boolean {
  return TOKEN_FIELDS.some((field) => {
    const item = tokens._map.get(tokenKey(tokenId, field));
    return item !== undefined && !item.deleted && isKeyWrittenByOthers(item, scope);
  });
}
