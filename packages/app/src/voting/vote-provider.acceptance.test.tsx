// @vitest-environment jsdom
// CONTRACT: only the newest vote read may reach the UI; an ended answer removes
// the live panel and dots, and a hidden vote is revealed before it can be ended.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';
import type { BoardConnection } from '../collab/board-connection.js';
import { VoteSection } from '../facilitation/vote-section.js';

import { fakeVoteApi, voteSession, type FakeVoteApi } from './__fixtures__/vote-session.js';
import type { VoteSession } from './vote-api.js';
import { useBoardVote } from './vote-context.js';
import { VoteProvider } from './vote-provider.js';

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function setup(isReadOnly = false, api: FakeVoteApi = fakeVoteApi(null)) {
  const connection = new FakeBoardConnection('board', undefined, isReadOnly);
  let changed: (() => void) | undefined;
  Object.assign(connection, {
    onVotesChanged: (callback: () => void) => {
      changed = callback;
      return vi.fn();
    },
  });
  function Surface() {
    const vote = useBoardVote();
    return vote === undefined ? null : <VoteSection vote={vote} />;
  }
  render(
    <VoteProvider boardId="board" connection={connection as BoardConnection} api={api}>
      <Surface />
    </VoteProvider>,
  );
  return {
    api,
    changed: () => {
      changed?.();
    },
  };
}

it('discards an older read even when it resolves after the newer notice read', async () => {
  const first = deferred<VoteSession | null>();
  const second = deferred<VoteSession | null>();
  const api = fakeVoteApi(null);
  api.read = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const fixture = setup(false, api);
  act(() => {
    fixture.changed();
  });
  await act(async () => {
    second.resolve(voteSession({ castCount: 2 }));
    await second.promise;
  });
  expect(screen.getByRole('group', { name: 'Dot vote' }).textContent).toContain('2 of 6 cast');
  await act(async () => {
    first.resolve(voteSession({ castCount: 0 }));
    await first.promise;
  });
  expect(screen.getByRole('group', { name: 'Dot vote' }).textContent).toContain('2 of 6 cast');
});

it('removes the live panel when a current vote ends', async () => {
  const fixture = setup();
  fixture.api.current = voteSession();
  act(() => {
    fixture.changed();
  });
  await flush();
  expect(screen.getByRole('group', { name: 'Dot vote' })).toBeTruthy();
  fixture.api.current = voteSession({ status: 'ended' });
  act(() => {
    fixture.changed();
  });
  await flush();
  expect(screen.queryByRole('group', { name: 'Dot vote' })).toBeNull();
});

it('reveals a hidden vote on End without calling the end route', async () => {
  const fixture = setup();
  fixture.api.current = voteSession();
  act(() => {
    fixture.changed();
  });
  await flush();
  fixture.api.next = voteSession({ status: 'revealed', results: [] });
  act(() => {
    screen.getByRole('button', { name: 'End' }).click();
  });
  await flush();
  expect(fixture.api.calls).toContain('reveal:session-1');
  expect(fixture.api.calls).not.toContain('end:session-1');
  expect(screen.getByRole('group', { name: 'Dot vote' }).textContent).toContain('Results shown');
});

it('shows a commenter revealed progress without Start, End, or Close', async () => {
  const fixture = setup(true);
  fixture.api.current = voteSession({ status: 'revealed', results: [{ objectId: 'a', count: 2 }] });
  act(() => {
    fixture.changed();
  });
  await flush();
  expect(screen.getByRole('group', { name: 'Dot vote' }).textContent).toContain('Results shown');
  expect(screen.queryByRole('button')).toBeNull();
});
