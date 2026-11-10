// @vitest-environment jsdom
// The Facilitate card's dot vote, timed and in a section: the timer's time left, the
// section, the voting cursor and a revealed vote's top stickies.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { voteSession } from '../voting/__fixtures__/vote-session.js';
import type { BoardVote } from '../voting/vote-context.js';

import { VoteSection } from './vote-section.js';

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

describe('VoteSection, timer, section and results', () => {
  it('starts a vote in the selected section, and names it', () => {
    const vote = boardVote();
    const { rerender } = render(<VoteSection vote={vote} scope={{ id: 'ideas', name: 'Ideas' }} />);
    expect(document.querySelector('[data-vote-scope]')?.textContent).toBe('In Ideas');
    fireEvent.click(screen.getByRole('button', { name: 'Start a dot vote in Ideas' }));
    expect(vote.start).toHaveBeenCalledWith('ideas');
    rerender(<VoteSection vote={vote} />);
    expect(document.querySelector('[data-vote-scope]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Start a dot vote' }));
    expect(vote.start).toHaveBeenLastCalledWith(null);
  });

  it('shows the running timer’s time left where the votes left were, and them in the count', () => {
    const session = voteSession({ castCount: 2, myVotes: ['a'] });
    const { rerender } = render(<VoteSection vote={boardVote({ session })} timeLeftMs={134_000} />);
    expect(screen.getByLabelText('Time left').textContent).toBe('02:14');
    expect(screen.getByText('2 of 6 cast · 2 left')).toBeTruthy();
    // Someone who cannot vote sees the time and the count only.
    rerender(<VoteSection vote={boardVote({ session, canVote: false })} timeLeftMs={134_000} />);
    expect(screen.getByText('2 of 6 cast')).toBeTruthy();
    // No timer: the votes left again.
    rerender(<VoteSection vote={boardVote({ session })} />);
    expect(screen.queryByLabelText('Time left')).toBeNull();
    expect(screen.getByText('2 left')).toBeTruthy();
  });

  it('names a live vote’s section', () => {
    render(<VoteSection vote={boardVote({ session: voteSession(), sectionName: 'Ideas' })} />);
    const panel = screen.getByRole('group', { name: 'Dot vote' });
    expect(panel.querySelector('[data-vote-scope]')?.textContent).toBe('In Ideas');
  });

  it('turns the voting cursor on and off while the vote is open', () => {
    const setCursorOn = vi.fn();
    const session = voteSession();
    const { rerender } = render(
      <VoteSection vote={boardVote({ session, isCursorOn: false, setCursorOn })} />,
    );
    const toggle = screen.getByRole('button', { name: 'Vote with clicks' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(setCursorOn).toHaveBeenLastCalledWith(true);
    rerender(<VoteSection vote={boardVote({ session, isCursorOn: true, setCursorOn })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Vote with clicks' }));
    expect(setCursorOn).toHaveBeenLastCalledWith(false);
    // None without the provider's cursor, for a viewer, or once the results show.
    rerender(<VoteSection vote={boardVote({ session })} />);
    expect(screen.queryByRole('button', { name: 'Vote with clicks' })).toBeNull();
    rerender(<VoteSection vote={boardVote({ session, canVote: false, setCursorOn })} />);
    expect(screen.queryByRole('button', { name: 'Vote with clicks' })).toBeNull();
    const revealed = voteSession({ status: 'revealed', results: [] });
    rerender(<VoteSection vote={boardVote({ session: revealed, setCursorOn })} />);
    expect(screen.queryByRole('button', { name: 'Vote with clicks' })).toBeNull();
  });

  it('lists a revealed vote’s top stickies, by rank, and the time no longer', () => {
    const ranked = [
      { id: 'over', label: 'Fix bugs', count: 4 },
      { id: 'inside', label: 'Ship it', count: 1 },
    ];
    const session = voteSession({ status: 'revealed', results: [] });
    const { rerender } = render(
      <VoteSection vote={boardVote({ session, ranked })} timeLeftMs={10_000} />,
    );
    const list = screen.getByRole('list', { name: 'Top stickies' });
    expect([...list.querySelectorAll('li')].map((item) => item.textContent)).toEqual([
      'Fix bugs4 votes',
      'Ship it1 vote',
    ]);
    expect(screen.queryByLabelText('Time left')).toBeNull();
    // An open vote, or one with no voted sticky left, lists none.
    rerender(<VoteSection vote={boardVote({ session, ranked: [] })} />);
    expect(screen.queryByRole('list', { name: 'Top stickies' })).toBeNull();
    rerender(<VoteSection vote={boardVote({ session: voteSession(), ranked })} />);
    expect(screen.queryByRole('list', { name: 'Top stickies' })).toBeNull();
  });
});
