// @vitest-environment jsdom
// The sticky popover's vote button (the design's frame A).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardObject } from '@canvas/schema';

import { voteSession } from '../voting/__fixtures__/vote-session.js';
import { voteContext, type BoardVote } from '../voting/vote-context.js';

import { OUTSIDE_SECTION_NAME, VoteButton, voteButtonNameOf } from './vote-button.js';

afterEach(cleanup);

const STICKY = { id: 'note', type: 'sticky' } as unknown as BoardObject;
const SHAPE = { id: 'box', type: 'shape' } as unknown as BoardObject;

/**
 * The button under a board's vote.
 *
 * @param vote - What differs from an editor's open vote.
 * @param selection - The selection.
 * @returns The vote's cast spy.
 */
function show(vote: Partial<BoardVote>, selection: readonly BoardObject[] = [STICKY]) {
  const cast = vi.fn();
  const value: BoardVote = {
    session: voteSession(),
    canVote: true,
    notice: undefined,
    start: vi.fn(),
    cast,
    retract: vi.fn(),
    finish: vi.fn(),
    ...vote,
  };
  render(
    <voteContext.Provider value={value}>
      <VoteButton selection={selection} />
    </voteContext.Provider>,
  );
  return cast;
}

describe('VoteButton', () => {
  it('casts one of the person’s votes for the selected sticky', () => {
    const cast = show({});
    const button = screen.getByRole('button', { name: 'Vote for this sticky (3 votes left)' });
    fireEvent.click(button);
    expect(cast).toHaveBeenCalledWith('note');
  });

  it('is disabled once the person’s votes are used', () => {
    show({ session: voteSession({ votesPerPerson: 1, myVotes: ['note'] }) });
    const button = screen.getByRole('button', { name: 'Vote for this sticky (no votes left)' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('is disabled on a sticky outside the vote’s section', () => {
    const isInScope = vi.fn((id: string) => id !== 'note');
    const cast = show({ isInScope });
    const button = screen.getByRole('button', { name: OUTSIDE_SECTION_NAME });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(cast).not.toHaveBeenCalled();
    expect(isInScope).toHaveBeenCalledWith('note');
  });

  it('shows only on a sticky, to the owner and editors, while a vote is open', () => {
    show({}, [SHAPE]);
    show({ canVote: false });
    show({ session: null });
    show({ session: voteSession({ status: 'revealed', results: [] }) });
    show({}, []);
    expect(screen.queryByRole('button')).toBeNull();
    render(<VoteButton selection={[STICKY]} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('names its votes left', () => {
    expect(voteButtonNameOf(1)).toBe('Vote for this sticky (1 vote left)');
  });
});
