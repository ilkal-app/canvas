// @vitest-environment jsdom
// The several-objects row during an open dot vote: a vote is for one
// sticky, so a mixed selection led by a sticky offers no "Vote for this sticky"; a lone sticky
// still does.
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { BoardVote } from '../voting/vote-context.js';

import { mount, preparePopover, propsOf, SHAPE } from './popover-shape-connector-fixtures.js';
import { STICKY } from './popover-viv-629-fixtures.js';

beforeEach(preparePopover);
afterEach(cleanup);

/** An open hidden vote the person can cast in, 3 each, none cast. */
const VOTE = {
  session: { id: 'vote-1', status: 'open', votesPerPerson: 3, myVotes: [], results: null },
  canVote: true,
  notice: undefined,
  start: vi.fn(),
  cast: vi.fn(),
  retract: vi.fn(),
  finish: vi.fn(),
} as unknown as BoardVote;

it('offers no sticky vote in the several-objects row, even led by a sticky', () => {
  mount(propsOf([STICKY, SHAPE]), VOTE);
  expect(screen.getByRole('toolbar', { name: 'Selection' }).textContent).toContain('2 selected');
  expect(screen.queryByRole('button', { name: /^Vote for this sticky/ })).toBeNull();
});

it('still offers it for a lone sticky', () => {
  mount(propsOf([STICKY]), VOTE);
  screen.getByRole('button', { name: /^Vote for this sticky/ });
});
