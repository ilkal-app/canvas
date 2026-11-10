import type { DocumentStore } from '@canvas/document';
import { isBuiltinToken, type ObjectId, type PageId } from '@canvas/schema';

import { INPUT_CHANGED_NOTICE } from '../notices/busy-notices.js';
import type { CanvasAction } from '../state/shell-action.js';

import type { InputEntry } from './document-input-queue.js';

/** Where a canvas action's checks read the board as it is now (`canvasActionEntry`). */
export interface CanvasInputContext {
  /** The whole board: a named main may be on another page. */
  readonly board: DocumentStore;
  /**
   * The page shown.
   *
   * @returns Its id; undefined before pages.
   */
  page(): PageId | undefined;
  /**
   * The selection.
   *
   * @returns Its ids.
   */
  selection(): readonly ObjectId[];
}

/**
 * Whether an action acts on the selection as it was when the person acted, so a changed
 * selection makes it stale.
 *
 * @param action - The action.
 * @returns True for the selection, arrange and nudge commands.
 */
function readsSelection(action: CanvasAction): boolean {
  return action.type === 'selection' || action.type === 'arrange' || action.type === 'nudge';
}

/**
 * Every object an action names: its targets, a layers drop's parent and neighbour, a component
 * command's object, the path segments it overrides and the swap options it lists.
 *
 * @param action - The action.
 * @returns The ids.
 */
export function namedObjectsOf(action: CanvasAction): readonly ObjectId[] {
  switch (action.type) {
    case 'style':
      return action.changes.map(({ id }) => id);
    case 'layout':
    case 'toggleLockOf':
    case 'autoLayout':
      return action.ids;
    case 'fitToContent':
    case 'linkCard':
    case 'replaceImage':
      return [action.id];
    case 'relinkText':
      return action.targets.map(({ id }) => id);
    case 'placeLayers':
      return [
        ...action.ids,
        ...(action.parentId === null ? [] : [action.parentId]),
        ...(action.belowId === undefined ? [] : [action.belowId]),
      ];
    case 'component': {
      const path = 'path' in action ? action.path.split('/') : [];
      const options = action.command === 'setSwapOptions' ? (action.options ?? []) : [];
      return [action.id, ...(path as ObjectId[]), ...options];
    }
    default:
      return [];
  }
}

/**
 * Whether an action names a custom colour token that is gone (a built-in one always exists).
 *
 * @param action - The action.
 * @param board - The whole board.
 * @returns True when its token was deleted.
 */
function isTokenGone(action: CanvasAction, board: DocumentStore): boolean {
  if (action.type !== 'colorToken' || !('id' in action)) return false;
  return !isBuiltinToken(action.id) && !board.readTokens().has(action.id);
}

/**
 * Two id lists with the same ids in the same order.
 *
 * @param a - One.
 * @param b - The other.
 * @returns Whether they are equal.
 */
function isSameIds(a: readonly ObjectId[], b: readonly ObjectId[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * A canvas action as queued input (`DocumentInputQueue`): what it needs is captured
 * now, the page and the selection, and at replay it is dropped with `INPUT_CHANGED_NOTICE` when
 * the page changed, when the selection it acts on changed, or when an object or token it names
 * is gone.
 *
 * @param action - The action.
 * @param context - The board, page and selection now.
 * @param run - Acts on it.
 * @returns The entry.
 */
export function canvasActionEntry(
  action: CanvasAction,
  context: CanvasInputContext,
  run: () => void,
): InputEntry {
  const page = context.page();
  const selection = context.selection();
  return {
    check: () => {
      if (context.page() !== page) return INPUT_CHANGED_NOTICE;
      if (readsSelection(action) && !isSameIds(context.selection(), selection)) {
        return INPUT_CHANGED_NOTICE;
      }
      const isGone = namedObjectsOf(action).some((id) => context.board.get(id) === undefined);
      return isGone || isTokenGone(action, context.board) ? INPUT_CHANGED_NOTICE : undefined;
    },
    run,
  };
}
