import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

import type { DocumentStore } from '@canvas/document';
import { NO_STICKY_AUTHORS, type StickyAuthors } from '@canvas/engine';

import type { MountedEngine } from '../engine/mounted-engine.js';
import type { BoardMembers } from '../service/board-people.js';

import { stickyAuthorNamesOf, stickyAuthorsFrom } from './sticky-author-names.js';

/**
 * Subscribes to nothing: without a store, authors are never shown.
 *
 * @returns An unsubscriber that does nothing.
 */
const NO_SUBSCRIPTION = (): (() => void) => () => undefined;

/**
 * Tells the engine who wrote each sticky: the board's "Show authors on stickies"
 * setting with the members' names (`stickyAuthorsOf`), sent once the engine runs and again when
 * the setting or the members change, never twice for the same setting and names.
 *
 * @param engine - The engine, once it runs.
 * @param store - The board's store, for its shared setting.
 * @param members - The board's members, when the person could read them.
 */
export function useStickyAuthors(
  engine: Pick<MountedEngine, 'setStickyAuthors'> | undefined,
  store: Pick<DocumentStore, 'stickyAuthors'> | undefined,
  members: BoardMembers | undefined,
): void {
  const subscribe = useCallback(
    (listener: () => void) => store?.stickyAuthors.subscribe(listener) ?? NO_SUBSCRIPTION(),
    [store],
  );
  const isShown = useSyncExternalStore(subscribe, () => store?.stickyAuthors.current ?? false);
  // One map per member list, so a setting change sends the same names.
  const names = useMemo(
    () => (members === undefined ? undefined : stickyAuthorNamesOf(members)),
    [members],
  );
  const sent = useRef<{ readonly engine: unknown; readonly authors: StickyAuthors }>(undefined);
  useEffect(() => {
    if (engine === undefined) return;
    const authors = names === undefined ? NO_STICKY_AUTHORS : stickyAuthorsFrom(isShown, names);
    const last = sent.current;
    if (
      last?.engine === engine &&
      last.authors.isShown === authors.isShown &&
      last.authors.names === authors.names
    ) {
      return;
    }
    sent.current = { engine, authors };
    engine.setStickyAuthors(authors);
  }, [engine, isShown, names]);
}
