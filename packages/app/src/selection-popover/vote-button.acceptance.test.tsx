// @vitest-environment jsdom
// CONTRACT: the selected sticky's vote button uses the person's actual myVotes
// allowance; its label counts down and it cannot cast a fourth vote.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import type { BoardObject } from '@canvas/schema';

import { voteSession } from '../voting/__fixtures__/vote-session.js';
import { voteContext, type BoardVote } from '../voting/vote-context.js';

import { VoteButton } from './vote-button.js';

afterEach(cleanup);

it('counts myVotes rather than the board total and disables the exhausted button', () => {
  const cast = vi.fn();
  const vote: BoardVote = {
    session: voteSession({ castCount: 20 }),
    canVote: true,
    notice: undefined,
    start: vi.fn(),
    cast,
    retract: vi.fn(),
    finish: vi.fn(),
  };
  const sticky = { id: 'sticky-1', type: 'sticky' } as BoardObject;
  const view = render(
    <voteContext.Provider value={vote}>
      <VoteButton selection={[sticky]} />
    </voteContext.Provider>,
  );
  expect(
    screen.getByRole('button', { name: 'Vote for this sticky (3 votes left)' }),
  ).toHaveProperty('disabled', false);
  for (const [used, label] of [
    [['other'], '2 votes left'],
    [['other', 'sticky-1'], '1 vote left'],
    [['other', 'sticky-1', 'sticky-1'], 'no votes left'],
  ] as const) {
    view.rerender(
      <voteContext.Provider
        value={{ ...vote, session: voteSession({ castCount: 20, myVotes: used }) }}
      >
        <VoteButton selection={[sticky]} />
      </voteContext.Provider>,
    );
    const button = screen.getByRole('button', { name: `Vote for this sticky (${label})` });
    expect(button).toHaveProperty('disabled', used.length === 3);
    fireEvent.click(button);
  }
  expect(cast).toHaveBeenCalledTimes(2);
});
