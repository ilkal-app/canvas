import { useEffect, useState } from 'react';

import type { ChangeSet } from '@canvas/document';

import type { BoardConnectionStatus } from '../collab/board-connection-status.js';
import type { BoardConnection } from '../collab/board-connection.js';

/** What {@link useLastEdit} reads of a board's connection: its store and its status. */
export type EditSource = Pick<BoardConnection, 'store' | 'status'>;

/** The last edit this session has seen on the board. */
export interface LastEdit {
  /** When it arrived, in ms since the epoch. */
  readonly at: number;
  /** Who made it: `You`, a collaborator's name, or undefined when it cannot be told. */
  readonly by: string | undefined;
}

/** Who the floating board bar says made the person's own edit. */
export const OWN_EDIT_AUTHOR = 'You';

/**
 * The edit a change set is, for the board bar's "edited … by …" (the coordinator's v1:
 * from this session's own view; adds the board record's last edit). The person's own
 * change (local, not the product's: seeding and repairs carry the system origin) is theirs; a
 * remote change once the first sync is done is a collaborator's, named when exactly one other
 * person is on the board (remote updates carry no author). The first sync and a reconnection's
 * catch-up are no edit. Pure.
 *
 * @param changes - The change set.
 * @param status - The connection's status when it arrived.
 * @param now - The time now.
 * @returns The edit, or undefined when the change set is none.
 */
export function lastEditOf(
  changes: ChangeSet,
  status: BoardConnectionStatus | undefined,
  now: number,
): LastEdit | undefined {
  if (changes.isLocal) {
    return changes.origin.kind === 'system' ? undefined : { at: now, by: OWN_EDIT_AUTHOR };
  }
  if (status?.state !== 'connected') return undefined;
  const [only, ...others] = status.collaborators;
  return { at: now, by: only !== undefined && others.length === 0 ? only.name : undefined };
}

/**
 * The last edit this session has seen on the board's store ({@link lastEditOf}); none until
 * one arrives.
 *
 * @param connection - The board's connection; none for the engine's local document.
 * @returns The last edit, if any.
 */
export function useLastEdit(connection: EditSource | undefined): LastEdit | undefined {
  const [lastEdit, setLastEdit] = useState<LastEdit | undefined>(undefined);
  useEffect(() => {
    if (connection === undefined) return undefined;
    return connection.store.subscribe((changes) => {
      const edit = lastEditOf(changes, connection.status(), Date.now());
      if (edit !== undefined) setLastEdit(edit);
    });
  }, [connection]);
  return lastEdit;
}

/**
 * The time now, refreshed every minute while `isRunning`, so a relative time ("1 minute ago")
 * moves on by itself.
 *
 * @param isRunning - Whether to tick.
 * @returns The time now, in ms since the epoch.
 */
export function useMinuteClock(isRunning: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isRunning) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 60_000);
    return () => {
      clearInterval(timer);
    };
  }, [isRunning]);
  return now;
}
