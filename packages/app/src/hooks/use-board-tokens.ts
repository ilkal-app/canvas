import { useCallback, useSyncExternalStore } from 'react';

import type { TokenTable } from '@canvas/schema';

import type { BoardView } from '../engine/board-view.js';

/** The table of a board without tokens, or before an engine mounts: the built-ins' defaults. */
const NO_TOKENS: TokenTable = new Map();

/**
 * Does nothing: the unsubscribe of a view without tokens.
 */
function stayQuiet(): void {
  // Nothing to stop.
}

/**
 * Follows a board view's colour token table, rendering again only when
 * a change set changes a token (`BoardView.subscribeTokens`), anyone's, on any page. The store
 * keeps its table until the next token change, so the snapshot is stable between changes. An
 * empty table (the built-ins at their defaults) with no view or a view without tokens.
 *
 * @param view - The mounted engine's board view, if any.
 * @returns The board's token table.
 */
export function useBoardTokens(view: BoardView | undefined): TokenTable {
  const subscribe = useCallback(
    (onChange: () => void) => view?.subscribeTokens?.(onChange) ?? stayQuiet,
    [view],
  );
  return useSyncExternalStore(subscribe, () => view?.tokens?.() ?? NO_TOKENS);
}
