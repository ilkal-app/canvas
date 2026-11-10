import type { VoteApi, VoteSession } from '../vote-api.js';

/**
 * A session as the boards service answers it: open, hidden, 3 each, two voters, no votes.
 *
 * @param fields - What differs.
 * @returns The session.
 */
export function voteSession(fields: Partial<VoteSession> = {}): VoteSession {
  return {
    id: 'session-1',
    status: 'open',
    votesPerPerson: 3,
    isHidden: true,
    castCount: 0,
    eligibleVoterCount: 2,
    myVotes: [],
    results: null,
    ...fields,
  };
}

/** A fake of the vote routes whose answers a test sets, and the calls made. */
export interface FakeVoteApi extends VoteApi {
  /** What `read` answers next. */
  current: VoteSession | null;
  /** What the next write answers, or the error it rejects with. */
  next: VoteSession | null | Error;
  /** Every call, as `name:args`. */
  readonly calls: string[];
  /** The read, which a test may replace (a read that fails). */
  read: VoteApi['read'];
  /** The cast, which a test may replace (one that answers late). */
  cast: VoteApi['cast'];
}

/**
 * Makes a fake of the vote routes.
 *
 * @param current - What `read` answers.
 * @returns The fake.
 */
export function fakeVoteApi(current: VoteSession | null = null): FakeVoteApi {
  const write = (call: string) => {
    fake.calls.push(call);
    const { next } = fake;
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  };
  const fake: FakeVoteApi = {
    current,
    next: null,
    calls: [],
    read: () => {
      fake.calls.push('read');
      return Promise.resolve(fake.current);
    },
    start: (votes, scopeId) =>
      write(
        scopeId === undefined || scopeId === null
          ? `start:${String(votes)}`
          : `start:${String(votes)}:${scopeId}`,
      ),
    cast: (id, objectId) => write(`cast:${id}:${objectId}`),
    retract: (id, objectId) => write(`retract:${id}:${objectId}`),
    reveal: (id) => write(`reveal:${id}`),
    end: (id) => write(`end:${id}`),
  };
  return fake;
}
