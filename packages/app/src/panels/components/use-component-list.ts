import { useMemo, useSyncExternalStore } from 'react';

import type { BoardReader, ChangeSet } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import type { BoardView } from '../../engine/board-view.js';

import {
  componentListOf,
  componentListWatchOf,
  isComponentListChange,
  type ComponentListItem,
} from './component-list.js';

/** What of a board view the list reads and follows. */
type ListedView = Pick<BoardView, 'board' | 'definitions' | 'subscribeDefinitions' | 'subscribe'>;

/** No mains. */
const NONE: readonly ComponentListItem[] = Object.freeze([]);

/**
 * The components panel's list over a board view, worked out when first read and again only
 * after a change set of the whole board that may change it (`isComponentListChange`), so a
 * board's ordinary edits cost a lookup per changed id. Main thread.
 */
export class ComponentListModel {
  readonly #board: BoardReader;
  readonly #listen: (listener: (changes: ChangeSet) => void) => () => void;
  #items: readonly ComponentListItem[] | undefined;
  #watched: ReadonlySet<ObjectId> = new Set();

  /**
   * Follows a board view's whole board.
   *
   * @param view - The board view, or what of one the list reads and follows.
   */
  constructor(view: ListedView) {
    this.#board = view.definitions ?? view.board;
    this.#listen =
      view.subscribeDefinitions?.bind(view) ??
      ((listener) =>
        view.subscribe((change) => {
          if (change.kind === 'document') listener(change.changes);
        }));
  }

  /**
   * The list now; the same array until it changes.
   *
   * @returns The mains.
   */
  readonly items = (): readonly ComponentListItem[] => {
    if (this.#items === undefined) {
      const items = componentListOf(this.#board);
      this.#items = items.length === 0 ? NONE : items;
      this.#watched = componentListWatchOf(this.#board, items);
    }
    return this.#items;
  };

  /**
   * Calls `onChange` when the list may have changed.
   *
   * @param onChange - The listener.
   * @returns A function that stops listening.
   */
  readonly subscribe = (onChange: () => void): (() => void) =>
    this.#listen((changes) => {
      if (this.#items === undefined) return;
      if (!isComponentListChange(this.#board, changes, this.#watched)) return;
      this.#items = undefined;
      onChange();
    });
}

/** Stands in for a model before an engine mounts. */
const NO_MODEL = { items: () => NONE, subscribe: () => () => undefined };

/**
 * Every live main on the board, following it (`ComponentListModel`); none before an engine
 * mounts.
 *
 * @param view - The board view, if any.
 * @returns The mains.
 */
export function useComponentList(view: BoardView | undefined): readonly ComponentListItem[] {
  const model = useMemo(
    () => (view === undefined ? NO_MODEL : new ComponentListModel(view)),
    [view],
  );
  return useSyncExternalStore(model.subscribe, model.items);
}

/**
 * A view's own change feed, unused where the whole board's is followed or none is given.
 *
 * @returns A function that stops nothing.
 */
function noViewFeed(): () => void {
  return () => undefined;
}

/**
 * Every live main on the board for a section of the inspector that reads the whole board
 * (`StylePanelSectionProps.definitions`), following its change feed (`watchDefinitions`) as the
 * components panel does: a main created, renamed or retired anywhere. Without a feed it
 * is worked out once per board; when not `isNeeded`, none, and nothing is worked out.
 *
 * @param watch - The whole board's change feed, if any.
 * @param board - The whole board.
 * @param isNeeded - Whether the section shows the list now.
 * @returns The mains.
 */
export function useBoardMains(
  watch: ((listener: (changes: ChangeSet) => void) => () => void) | undefined,
  board: BoardReader,
  isNeeded: boolean,
): readonly ComponentListItem[] {
  const model = useMemo(
    () =>
      new ComponentListModel(
        watch === undefined
          ? { board, subscribe: noViewFeed }
          : { board, subscribeDefinitions: watch, subscribe: noViewFeed },
      ),
    [board, watch],
  );
  return useSyncExternalStore(model.subscribe, isNeeded ? model.items : NO_MODEL.items);
}
