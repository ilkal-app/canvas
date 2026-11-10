import * as Y from 'yjs';

import type { PageId } from '@canvas/schema';

import type { BoardReader } from '../commands/command.js';
import { PAGE_FIELDS, pageKey, parsePageKey } from '../pages/page-map.js';
import type { StyleSources } from '../store/style-tables.js';

import { causalPastOf } from './causal-past.js';
import type { UndoStep } from './field-guard.js';
import { isStyleTouchedSince, removedStyles } from './style-guard.js';
import { isTokenTouchedSince, removedTokens } from './token-guard.js';
import { isKeyWrittenByOthers, writerScopeOf, type WriterScope } from './written-by-others.js';

// For pages: a page counts as an object for the
// creation guard. Its keys are its fields, and an object whose placement names it refers to it.
// So an undo or redo that would remove a page (undoing `addPage` or `duplicatePage`, redoing
// `deletePage`) changes nothing when another person has since renamed or reordered the page,
// put an object on it, or written to an object the step would remove (the creation guard keeps
// it): the step is used up, never partly applied.

/**
 * The pages a step would remove: live `.identity` entries of the pages map among its
 * insertions, or the entries an undo or redo has since re-created them as.
 *
 * @param transaction - The open transaction.
 * @param step - The step.
 * @param pages - The pages map.
 * @returns The ids of the pages it would remove.
 */
function removedPages(transaction: Y.Transaction, step: UndoStep, pages: Y.Map<unknown>): PageId[] {
  const removed: PageId[] = [];
  Y.iterateDeletedStructs(transaction, step.insertions, (struct) => {
    if (!(struct instanceof Y.Item) || struct.parent !== pages || struct.parentSub === null) return;
    const parsed = parsePageKey(struct.parentSub);
    if (parsed?.field !== 'identity') return;
    let entry = struct;
    while (entry.redone !== null) {
      const next = Y.getItem(transaction.doc.store, entry.redone);
      if (!(next instanceof Y.Item)) return;
      entry = next;
    }
    if (!entry.deleted) removed.push(parsed.pageId);
  });
  return removed;
}

/**
 * Whether another person has touched a page since the step: written one of its keys, or
 * written the placement of an object on it.
 *
 * @param pageId - The page.
 * @param context - The maps, the board before the step and the step's scope.
 * @param context.pages - The pages map.
 * @param context.objects - The objects map.
 * @param context.board - The board before the step.
 * @param context.scope - The step's scope.
 * @returns True when the page must be kept.
 */
function isPageTouchedSince(
  pageId: PageId,
  context: {
    readonly pages: Y.Map<unknown>;
    readonly objects: Y.Map<unknown>;
    readonly board: BoardReader;
    readonly scope: WriterScope;
  },
): boolean {
  const { pages, objects, board, scope } = context;
  for (const field of PAGE_FIELDS) {
    const item = pages._map.get(pageKey(pageId, field));
    if (item !== undefined && !item.deleted && isKeyWrittenByOthers(item, scope)) return true;
  }
  for (const id of board.references.childrenOf(null)) {
    if (board.get(id)?.pageId !== pageId) continue;
    const entry = objects._map.get(id);
    const map = entry?.content instanceof Y.ContentType ? entry.content.type : undefined;
    const placement = map?._map.get('placement');
    if (placement !== undefined && isKeyWrittenByOthers(placement, scope)) return true;
  }
  return false;
}

/**
 * Tells whether an undo or redo step must be used up unapplied because it would remove a page
 * another person has touched since, or would remove a page while the creation guard keeps an
 * object of the same step (see above), or would remove a colour token another person has written
 * since (`token-guard.ts`), or a named style another person has written since
 * (`style-guard.ts`). Joins the undo or redo transaction, before Yjs applies
 * the step. Cost: the step's inserted structs, the removed pages' keys and the board's root
 * objects once per removed page.
 *
 * @param transaction - The open transaction.
 * @param step - The step.
 * @param maps - The document's pages, objects and tokens maps.
 * @param maps.pages - The pages map.
 * @param maps.objects - The objects map.
 * @param maps.tokens - The colour tokens map.
 * @param maps.styles - The named style maps.
 * @param board - The board before the step.
 * @param isObjectKept - Whether the creation guard keeps an object the step would remove.
 * @returns True to use the step up unapplied.
 */
export function isPageRemovalBlocked(
  transaction: Y.Transaction,
  step: UndoStep,
  maps: {
    readonly pages: Y.Map<unknown>;
    readonly objects: Y.Map<unknown>;
    readonly tokens: Y.Map<unknown>;
    readonly styles: StyleSources;
  },
  board: BoardReader,
  isObjectKept: boolean,
): boolean {
  const removed = removedPages(transaction, step, maps.pages);
  const removedTokenIds = removedTokens(transaction, step, maps.tokens);
  const removedStyleIds = (['text', 'effect'] as const).flatMap((kind) =>
    removedStyles(transaction, step, maps.styles[kind]).map((styleId) => ({ kind, styleId })),
  );
  if (removed.length === 0 && removedTokenIds.length === 0 && removedStyleIds.length === 0) {
    return false;
  }
  if (removed.length > 0 && isObjectKept) return true;
  const past = causalPastOf(step);
  if (past === undefined) return false;
  const scope = writerScopeOf(past, transaction.doc);
  return (
    removed.some((pageId) => isPageTouchedSince(pageId, { ...maps, board, scope })) ||
    removedTokenIds.some((tokenId) => isTokenTouchedSince(tokenId, maps.tokens, scope)) ||
    removedStyleIds.some(({ kind, styleId }) =>
      isStyleTouchedSince(styleId, maps.styles[kind], scope),
    )
  );
}
