// The board's dot-vote routes (services/boards vote-routes.ts): each verb and path, and
// the session read from each answer.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { voteSession } from './__fixtures__/vote-session.js';
import { voteApiFor } from './vote-api.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('voteApiFor', () => {
  it('calls each route and reads the session it answers', async () => {
    const session = voteSession();
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string, init?: RequestInit) => {
        const body = typeof init?.body === 'string' ? ` ${init.body}` : '';
        seen.push(`${init?.method ?? 'GET'} ${input}${body}`);
        // The first answer has no body: no session.
        const answer = seen.length === 1 ? null : JSON.stringify({ session });
        return Promise.resolve(
          new Response(answer, {
            status: answer === null ? 204 : 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }),
    );
    const api = voteApiFor('board 1');
    expect(await api.read()).toBeNull();
    expect(await api.start(3)).toEqual(session);
    await api.cast('s/1', 'note');
    await api.retract('s/1', 'note/2');
    await api.reveal('s/1');
    await api.end('s/1');
    expect(seen).toEqual([
      'GET /api/boards/board%201/votes',
      'POST /api/boards/board%201/votes {"votesPerPerson":3}',
      'POST /api/boards/board%201/votes/s%2F1/votes {"objectId":"note"}',
      'DELETE /api/boards/board%201/votes/s%2F1/votes/note%2F2',
      'POST /api/boards/board%201/votes/s%2F1/reveal',
      'POST /api/boards/board%201/votes/s%2F1/end',
    ]);
  });
});
