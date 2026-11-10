import { useCallback } from 'react';

import { DEFAULT_TIMER_DURATION_MS, type ObjectId } from '@canvas/schema';

import type { BoardConnection } from '../collab/board-connection.js';

import { runBoardTimer } from './use-board-timer.js';

/**
 * Starts the board timer for one section (the section's popover): the default
 * duration, replacing any timer, as the Facilitate card's Start does for the board.
 *
 * @param connection - The board's connection; none (or one without a store) has no timer.
 * @returns The starter, or undefined where the board has no shared timer.
 */
export function useSectionTimer(
  connection: BoardConnection | undefined,
): ((sectionId: ObjectId) => void) | undefined {
  const store = connection?.store;
  const origin = connection?.origin;
  const serverClock = connection?.serverClock;
  const start = useCallback(
    (sectionId: ObjectId): void => {
      if (store === undefined || origin === undefined) return;
      runBoardTimer(
        { store, origin, serverClock },
        { kind: 'start', durationMs: DEFAULT_TIMER_DURATION_MS, sectionId },
      );
    },
    [store, origin, serverClock],
  );
  return store === undefined || origin === undefined ? undefined : start;
}
