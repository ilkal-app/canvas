import { useEffect, useMemo, useState } from 'react';

import { SearchIndex, type BoardSnapshot, type ChangeSet, type SearchHit } from '@canvas/document';
import type { PageId } from '@canvas/schema';

import type { BoardView } from '../engine/board-view.js';

/** The index of the whole board and how many change sets it has taken. */
interface IndexState {
  /** The index, or undefined before the engine mounts or where the board cannot be read. */
  readonly index: SearchIndex | undefined;
  /** Increases with every change set the index takes, so results follow the board. */
  readonly version: number;
}

const NO_INDEX: IndexState = { index: undefined, version: 0 };

/** The whole board across pages, to read and to follow. */
interface WholeBoard {
  /** The board now. */
  readonly read: () => BoardSnapshot;
  /** Calls the listener after each change set, on any page; returns the unsubscribe. */
  readonly subscribe: (listener: (changes: ChangeSet) => void) => () => void;
}

/**
 * The whole board of a view, where it has one to read and follow (the engine's does).
 *
 * @param view - The view.
 * @returns The whole board, or undefined.
 */
function wholeBoardOf(view: BoardView | undefined): WholeBoard | undefined {
  const read = view?.definitions?.read?.bind(view.definitions);
  const subscribe = view?.subscribeDefinitions?.bind(view);
  return read === undefined || subscribe === undefined ? undefined : { read, subscribe };
}

/**
 * The board search index (`SearchIndex`) while the sheet is mounted: built from the
 * whole board across pages when it opens, then kept current from the board's change sets, which
 * it reads by id only; dropped when the sheet closes, so a closed sheet costs nothing.
 *
 * @param view - The engine's board view; none before the engine mounts.
 * @returns The index and its version.
 */
function useSearchIndex(view: BoardView | undefined): IndexState {
  const [state, setState] = useState<IndexState>(NO_INDEX);
  useEffect(() => {
    const whole = wholeBoardOf(view);
    if (whole === undefined) {
      setState(NO_INDEX);
      return undefined;
    }
    const index = new SearchIndex(whole.read());
    let version = 0;
    setState({ index, version });
    return whole.subscribe((changes) => {
      index.apply(changes, whole.read());
      version += 1;
      setState({ index, version });
    });
  }, [view]);
  return state;
}

/**
 * The board search sheet's results for a query: on the page shown, or on every page.
 *
 * @param view - The engine's board view.
 * @param query - The query.
 * @param pageId - The page to search, or undefined for every page.
 * @returns The results, in group order; none for a blank query.
 */
export function useBoardSearch(
  view: BoardView | undefined,
  query: string,
  pageId: PageId | undefined,
): readonly SearchHit[] {
  const { index, version } = useSearchIndex(view);
  return useMemo(
    () => (index === undefined ? [] : index.search(query, pageId === undefined ? {} : { pageId })),
    // `version` changes when the index takes a change set.
    [index, version, query, pageId],
  );
}
