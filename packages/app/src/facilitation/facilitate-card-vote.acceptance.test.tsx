// @vitest-environment jsdom
// CONTRACT: only a running timer lends its time-left slot to the vote; pausing
// preserves the vote count without showing a stale countdown there.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { YjsDocumentStore, type TransactionOrigin } from '@canvas/document';
import type { PrincipalId } from '@canvas/schema';

import { voteSession } from '../voting/__fixtures__/vote-session.js';
import { voteContext } from '../voting/vote-context.js';

import { FacilitateCard } from './facilitate-card.js';

afterEach(cleanup);

it('does not show the vote time slot when the shared timer is paused', () => {
  const store = new YjsDocumentStore();
  const origin: TransactionOrigin = { kind: 'user', principalId: 'user:vote' as PrincipalId };
  const vote = {
    session: voteSession({ castCount: 12, eligibleVoterCount: 6 }),
    canVote: true,
    notice: undefined,
    start: vi.fn(),
    cast: vi.fn(),
    retract: vi.fn(),
    finish: vi.fn(),
  };
  render(
    <voteContext.Provider value={vote}>
      <FacilitateCard
        source={{ store, origin, serverClock: { now: () => 1_790_000_000_000 } }}
        canEdit
        storage={{ getItem: () => null, setItem: vi.fn() }}
        createChime={() => ({ play: vi.fn(() => true), dispose: vi.fn() })}
      />
    </voteContext.Provider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Start the timer' }));
  expect(
    screen.getByRole('group', { name: 'Dot vote' }).querySelector('[data-vote-time-left]'),
  ).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Pause the timer' }));
  const panel = screen.getByRole('group', { name: 'Dot vote' });
  expect(panel.querySelector('[data-vote-time-left]')).toBeNull();
  expect(panel.textContent).toContain('12 of 18 cast');
});
