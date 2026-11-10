// @vitest-environment jsdom
// The Facilitate card's dot vote (the design's frames A and B).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { voteSession } from '../voting/__fixtures__/vote-session.js';
import type { BoardVote } from '../voting/vote-context.js';

import { VoteSection, voteProgressOf, voteTitleOf } from './vote-section.js';

afterEach(cleanup);

/**
 * A board's vote with its actions spied on.
 *
 * @param fields - What differs.
 * @returns The vote.
 */
function boardVote(fields: Partial<BoardVote> = {}): BoardVote {
  return {
    session: null,
    canVote: true,
    notice: undefined,
    start: vi.fn(),
    cast: vi.fn(),
    retract: vi.fn(),
    finish: vi.fn(),
    ...fields,
  };
}

describe('VoteSection', () => {
  it('offers the owner and editors a vote to start, and anyone else nothing', () => {
    const vote = boardVote();
    const { rerender, container } = render(<VoteSection vote={vote} />);
    expect(screen.getByText('Dot vote · 3 each')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start a dot vote' }));
    expect(vote.start).toHaveBeenCalled();
    rerender(<VoteSection vote={boardVote({ canVote: false })} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows an open vote’s progress, the votes left and End', () => {
    const vote = boardVote({
      session: voteSession({ castCount: 4, myVotes: ['a'], eligibleVoterCount: 3 }),
    });
    render(<VoteSection vote={vote} />);
    const panel = screen.getByRole('group', { name: 'Dot vote' });
    expect(panel.textContent).toContain('Dot vote · 3 each');
    expect(panel.textContent).toContain('2 left');
    expect(panel.textContent).toContain('4 of 9 cast');
    const bar = screen.getByRole('progressbar', { name: 'Votes cast' });
    expect([bar.getAttribute('aria-valuenow'), bar.getAttribute('aria-valuemax')]).toEqual([
      '4',
      '9',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'End' }));
    expect(vote.finish).toHaveBeenCalled();
  });

  it('closes a revealed vote, and shows a viewer the vote without its actions', () => {
    const vote = boardVote({ session: voteSession({ status: 'revealed', results: [] }) });
    const { rerender } = render(<VoteSection vote={vote} />);
    expect(screen.getByText('Results shown')).toBeTruthy();
    expect(screen.queryByText(/left$/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(vote.finish).toHaveBeenCalled();
    rerender(<VoteSection vote={boardVote({ canVote: false, session: voteSession() })} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(/left$/)).toBeNull();
  });

  it('says why an action failed', () => {
    render(<VoteSection vote={boardVote({ notice: 'You have used all your votes' })} />);
    expect(screen.getByRole('status').textContent).toBe('You have used all your votes');
  });
});

describe('the vote section’s words and progress', () => {
  it('names a vote by its allowance, and measures its progress', () => {
    expect(voteTitleOf(5)).toBe('Dot vote · 5 each');
    expect(voteProgressOf(voteSession({ castCount: 3 }))).toBe(0.5);
    expect(voteProgressOf(voteSession({ castCount: 9 }))).toBe(1);
    expect(voteProgressOf(voteSession({ eligibleVoterCount: 0 }))).toBe(0);
  });
});
