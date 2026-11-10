// @vitest-environment jsdom
// The sticky row's placeholder Vote gives way to the popover's own Vote while a dot
// vote is open, so a sticky shows one Vote, never two.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardObject } from '@canvas/schema';

import { voteSession } from '../voting/__fixtures__/vote-session.js';
import { voteContext, type BoardVote } from '../voting/vote-context.js';

import { VoteButton as VotePlaceholder } from './popover-row-parts.js';
import { VoteButton } from './vote-button.js';

afterEach(cleanup);

const STICKY = { id: 'note', type: 'sticky' } as unknown as BoardObject;

/**
 * Both Vote buttons under a board's vote, as the sticky's popover row draws them.
 *
 * @param vote - The board's vote, if any.
 */
function show(vote: BoardVote | undefined): void {
  render(
    <voteContext.Provider value={vote}>
      <VotePlaceholder />
      <VoteButton selection={[STICKY]} />
    </voteContext.Provider>,
  );
}

/**
 * A vote the person can take part in.
 *
 * @param session - The session.
 * @returns The vote.
 */
function voteOf(session: BoardVote['session']): BoardVote {
  return {
    session,
    canVote: true,
    notice: undefined,
    start: vi.fn(),
    cast: vi.fn(),
    retract: vi.fn(),
    finish: vi.fn(),
  };
}

describe('the sticky row’s Vote', () => {
  it('is the disabled placeholder alone while no vote is open', () => {
    show(undefined);
    expect(screen.getAllByRole('button', { name: /^Vote/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Vote' }).getAttribute('aria-disabled')).toBe('true');
    cleanup();
    show(voteOf(null));
    expect(screen.getAllByRole('button', { name: /^Vote/ })).toHaveLength(1);
  });

  it('is the popover’s own Vote alone while a vote is open', () => {
    show(voteOf(voteSession()));
    const votes = screen.getAllByRole('button', { name: /^Vote/ });
    expect(votes).toHaveLength(1);
    expect(votes[0]?.getAttribute('aria-label')).toMatch(/^Vote for this sticky/);
  });
});
