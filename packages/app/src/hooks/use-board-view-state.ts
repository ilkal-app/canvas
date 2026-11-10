import { useCallback, useMemo, useSyncExternalStore } from 'react';

import type { BoardReader, ChangeSet } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import type { BoardView, BoardViewState } from '../engine/board-view.js';

/** What the panels read of the board while rendering. */
export interface BoardViewSnapshot extends BoardViewState {
  /** The document; empty while no engine is mounted. */
  readonly board: BoardReader;
  /**
   * The whole board across pages, where `board` shows one page; `board` when the
   * view has none, and absent where a snapshot is made by hand.
   */
  readonly definitions?: BoardReader;
  /**
   * Listens for the whole board's change sets (`BoardView.subscribeDefinitions`); absent when
   * the view has none.
   */
  readonly watchDefinitions?: (listener: (changes: ChangeSet) => void) => () => void;
}

const NO_IDS: ReadonlySet<ObjectId> = new Set();
const noObject = (): undefined => undefined;
const noIds = (): ReadonlySet<ObjectId> => NO_IDS;

/** The board before an engine mounts (or under a mount without a board view): nothing. */
const EMPTY_BOARD: BoardReader = {
  get: noObject,
  references: {
    childrenOf: noIds,
    topChildOf: noObject,
    connectorsAttachedTo: noIds,
    commentsAnchoredTo: noIds,
    instancesOf: noIds,
  },
};

const EMPTY_STATE: BoardViewState = { documentVersion: 0, selectedIds: [], enteredGroupId: null };

/**
 * Listens to a board view for `useSyncExternalStore`: a selection change at once, a change set
 * at once unless a stepped run holds the board, whose change sets are followed once
 * at its end (`BoardView.whenIdle`). A page switch announces its page a slice per task, and the
 * shell renders once after the switch rather than once a slice.
 *
 * @param view - The board view.
 * @param onChange - Tells React the snapshot may have changed.
 * @returns A function that unsubscribes.
 */
function followView(view: BoardView, onChange: () => void): () => void {
  let isWaiting = false;
  let isStopped = false;
  const stop = view.subscribe((change) => {
    if (change.kind !== 'document' || view.whenIdle === undefined) {
      onChange();
      return;
    }
    if (isWaiting) return;
    isWaiting = true;
    view.whenIdle(() => {
      isWaiting = false;
      if (!isStopped) onChange();
    });
  });
  return () => {
    isStopped = true;
    stop();
  };
}

/**
 * Follows a board view's document version and selection, rendering again when either changes
 * (`useSyncExternalStore`, so a change set arriving mid-render never tears); the change sets of
 * a stepped run render once, at its end (`followView`). With no view (no engine mounted yet) it
 * reports an empty board with nothing selected.
 *
 * @param view - The mounted engine's board view, if any.
 * @returns The board, its version and the selection.
 */
export function useBoardViewState(view: BoardView | undefined): BoardViewSnapshot {
  const subscribe = useCallback(
    (onChange: () => void) => (view === undefined ? noObject : followView(view, onChange)),
    [view],
  );
  const state = useSyncExternalStore(subscribe, () => view?.state() ?? EMPTY_STATE);
  const watchDefinitions = useMemo(() => view?.subscribeDefinitions?.bind(view), [view]);
  const board = view?.board ?? EMPTY_BOARD;
  const definitions = view?.definitions ?? board;
  return { ...state, board, definitions, ...(watchDefinitions && { watchDefinitions }) };
}
