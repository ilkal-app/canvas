import { useCallback, useContext, useMemo, useSyncExternalStore } from 'react';

import type { BoardConnection } from '../collab/board-connection.js';
import { commentDataContext } from '../comments/comment-data-context.js';
import type { MountedEngine } from '../engine/mounted-engine.js';
import type { StickyAuthorsToggle } from '../selection-popover/popover-controls.js';

import { toggleStickyAuthors } from './sticky-authors-toggle.js';
import { useStickyAuthors } from './use-sticky-authors.js';

/**
 * Subscribes to nothing: without a store, authors are never shown.
 *
 * @returns An unsubscriber that does nothing.
 */
const NO_SUBSCRIPTION = (): (() => void) => () => undefined;

/**
 * The board's sticky authors in the shell: tells the engine who wrote each sticky
 * (`useStickyAuthors`, names from the members the comments read, none where they could not be
 * read) and gives the sticky popover its Author toggle over the board's shared setting.
 *
 * @param engine - The engine, once it runs.
 * @param connection - The board's connection; a board without a store has no setting.
 * @returns The toggle, or undefined where the board has no shared store.
 */
export function useStickyAuthorsControl(
  engine: MountedEngine | undefined,
  connection: BoardConnection | undefined,
): StickyAuthorsToggle | undefined {
  const store = connection?.store;
  const members = useContext(commentDataContext)?.boardMembers;
  useStickyAuthors(engine, store, members);
  const subscribe = useCallback(
    (listener: () => void) => store?.stickyAuthors.subscribe(listener) ?? NO_SUBSCRIPTION(),
    [store],
  );
  const isShown = useSyncExternalStore(subscribe, () => store?.stickyAuthors.current ?? false);
  return useMemo(
    () =>
      store === undefined
        ? undefined
        : {
            isShown,
            onToggle: () => {
              toggleStickyAuthors(store);
            },
          },
    [store, isShown],
  );
}
