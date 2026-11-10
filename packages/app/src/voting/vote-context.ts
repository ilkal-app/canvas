import { createContext, useContext } from 'react';

import type { VoteSession } from './vote-api.js';
import type { RankedSticky } from './vote-board.js';

/** How many votes each person has in a vote the Facilitate card starts (the design's "3 each"). */
export const DEFAULT_VOTES_PER_PERSON = 3;

/**
 * The board's dot vote as the shell's surfaces see it: the Facilitate card's vote row,
 * the sticky popover's vote button and the dots on stickies.
 */
export interface BoardVote {
  /** The current session, or null when none is (or before it is read). */
  readonly session: VoteSession | null;
  /** Whether the person may start, cast in and end votes: the owner and editors. */
  readonly canVote: boolean;
  /** What the last action failed with, in the person's words; undefined when it did not. */
  readonly notice: string | undefined;
  /**
   * Starts a hidden vote of {@link DEFAULT_VOTES_PER_PERSON} each, in a section (a frame's id)
   * or, without one, on the whole board.
   */
  readonly start: (scopeId?: string | null) => void;
  /** Casts one of the person's votes for an object (a sticky), by its id. */
  readonly cast: (objectId: string) => void;
  /** Takes back the person's latest vote for an object, by its id. */
  readonly retract: (objectId: string) => void;
  /**
   * Ends the casting: reveals a hidden vote's results, or ends one already shown and keeps its
   * results on the board as a "Vote results" sticky.
   */
  readonly finish: () => void;
  /**
   * Whether a sticky counts in the vote: inside its section, if it has one; every
   * sticky when absent.
   */
  readonly isInScope?: (objectId: string) => boolean;
  /** The vote's section's name, while it has one. */
  readonly sectionName?: string | undefined;
  /** The results' stickies by rank, with their labels, once they may be seen; none if absent. */
  readonly ranked?: readonly RankedSticky[];
  /** Whether the voting cursor is on: a press on a sticky votes for it, ⌥ takes one back. */
  readonly isCursorOn?: boolean;
  /** Turns the voting cursor on or off. */
  readonly setCursorOn?: (isOn: boolean) => void;
}

/** The board's vote; undefined where the board has no boards service (a local board). */
export const voteContext = createContext<BoardVote | undefined>(undefined);

/**
 * Reads the board's vote.
 *
 * @returns The vote on a signed-in board, otherwise undefined.
 */
export function useBoardVote(): BoardVote | undefined {
  return useContext(voteContext);
}

/**
 * How many votes the person has left in a session.
 *
 * @param session - The session.
 * @returns Its allowance less their votes, never below zero.
 */
export function votesLeftIn(session: VoteSession): number {
  return Math.max(session.votesPerPerson - session.myVotes.length, 0);
}

/**
 * The votes a sticky shows (the design's dots): everyone's once the results may be seen, else
 * the person's own.
 *
 * @param session - The session.
 * @returns Votes by object id.
 */
export function shownVotesOf(session: VoteSession): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  if (session.results !== null) {
    for (const { objectId, count } of session.results) counts.set(objectId, count);
    return counts;
  }
  for (const id of session.myVotes) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}
