import { createApiTransport } from '../service/api-transport.js';

/** How many votes a sticky has, as the boards service counts them. */
export interface VoteResult {
  /** The object voted for. */
  readonly objectId: string;
  /** Its votes, everyone's. */
  readonly count: number;
}

/**
 * The board's current dot vote as the person may see it (services/boards
 * `VoteSessionView`): its settings and progress, the person's own votes and, once they may be
 * seen, everyone's results.
 */
export interface VoteSession {
  /** Its id, for the routes that act on it. */
  readonly id: string;
  /** Open (casting), revealed (results shown, no more casting) or ended. */
  readonly status: 'open' | 'revealed' | 'ended';
  /** How many votes each person has. */
  readonly votesPerPerson: number;
  /** Whether the results stay hidden until the reveal. */
  readonly isHidden: boolean;
  /** Every vote cast so far, a count only. */
  readonly castCount: number;
  /** How many people may vote: the owner and the editors. */
  readonly eligibleVoterCount: number;
  /** The person's own votes, object ids, oldest first; one id per vote. */
  readonly myVotes: readonly string[];
  /** Everyone's votes, most first, once they may be seen; null while hidden. */
  readonly results: readonly VoteResult[] | null;
  /** The section (frame) it counts stickies in, or null for the whole board. */
  readonly scopeId?: string | null;
}

/**
 * Calls one of the board's session-only vote routes through the site's transport.
 *
 * @param boardId - The board.
 * @param method - The HTTP verb.
 * @param suffix - The encoded path after `votes`, if any.
 * @param body - The JSON body, if any.
 * @returns The session as the person may now see it, or null when none is current.
 */
async function voteRequest(
  boardId: string,
  method: 'GET' | 'POST' | 'DELETE',
  suffix = '',
  body?: unknown,
): Promise<VoteSession | null> {
  return createApiTransport()({
    method,
    path: `/api/boards/${encodeURIComponent(boardId)}/votes${suffix}`,
    ...(body === undefined ? {} : { body }),
    read: (value) => ((value ?? {}) as { session?: VoteSession | null }).session ?? null,
  });
}

/** The board's dot-vote routes for one board, each answering the session after it. */
export interface VoteApi {
  /** The current session, or null. */
  readonly read: () => Promise<VoteSession | null>;
  /**
   * Starts a hidden vote of `votesPerPerson` each, in a section (a frame's id) or, without one,
   * on the whole board (409 `vote-open` while one is current).
   */
  readonly start: (votesPerPerson: number, scopeId?: string | null) => Promise<VoteSession | null>;
  /** Casts one vote for an object (409 `vote-limit` once the allowance is used). */
  readonly cast: (sessionId: string, objectId: string) => Promise<VoteSession | null>;
  /** Takes back the person's latest vote for an object. */
  readonly retract: (sessionId: string, objectId: string) => Promise<VoteSession | null>;
  /** Shows everyone's results and stops casting. */
  readonly reveal: (sessionId: string) => Promise<VoteSession | null>;
  /** Ends the vote. */
  readonly end: (sessionId: string) => Promise<VoteSession | null>;
}

/**
 * The vote routes of a board.
 *
 * @param boardId - The board.
 * @returns Its routes.
 */
export function voteApiFor(boardId: string): VoteApi {
  const session = (id: string) => `/${encodeURIComponent(id)}`;
  return {
    read: () => voteRequest(boardId, 'GET'),
    start: (votesPerPerson, scopeId) =>
      voteRequest(boardId, 'POST', '', {
        votesPerPerson,
        ...(scopeId === undefined || scopeId === null ? {} : { scopeId }),
      }),
    cast: (id, objectId) => voteRequest(boardId, 'POST', `${session(id)}/votes`, { objectId }),
    retract: (id, objectId) =>
      voteRequest(boardId, 'DELETE', `${session(id)}/votes/${encodeURIComponent(objectId)}`),
    reveal: (id) => voteRequest(boardId, 'POST', `${session(id)}/reveal`),
    end: (id) => voteRequest(boardId, 'POST', `${session(id)}/end`),
  };
}
