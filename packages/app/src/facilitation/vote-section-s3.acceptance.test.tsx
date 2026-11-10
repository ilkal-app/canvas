// @vitest-environment jsdom
// CONTRACT: commenters see a live vote but cannot activate the voting cursor.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { voteSession } from '../voting/__fixtures__/vote-session.js';

import { VoteSection } from './vote-section.js';

afterEach(cleanup);

it('omits the click-voting toggle for a commenter', () => {
  render(
    <VoteSection
      vote={{
        session: voteSession(),
        canVote: false,
        notice: undefined,
        start: vi.fn(),
        cast: vi.fn(),
        retract: vi.fn(),
        finish: vi.fn(),
        isCursorOn: false,
        setCursorOn: vi.fn(),
      }}
    />,
  );
  expect(screen.getByRole('group', { name: 'Dot vote' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Vote with clicks' })).toBeNull();
});
