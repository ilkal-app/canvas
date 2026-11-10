// @vitest-environment jsdom
// The Facilitate card holds the board's dot vote below its timer, on a signed-in board,
// and hides it with the timer when collapsed.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { YjsDocumentStore, type TransactionOrigin } from '@canvas/document';
import type { PrincipalId } from '@canvas/schema';

import { voteSession } from '../voting/__fixtures__/vote-session.js';
import { voteContext, type BoardVote } from '../voting/vote-context.js';

import { FacilitateCard } from './facilitate-card.js';

afterEach(cleanup);

const ADA: TransactionOrigin = { kind: 'user', principalId: 'user:ada' as PrincipalId };

describe('FacilitateCard on a page with Web Audio', () => {
  it('makes its own chime over the page’s audio when none is given', () => {
    vi.stubGlobal('AudioContext', vi.fn());
    try {
      render(<FacilitateCard source={{ store: new YjsDocumentStore(), origin: ADA }} canEdit />);
      expect(screen.getByRole('region', { name: 'Facilitate' })).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('FacilitateCard with a dot vote', () => {
  it('shows the vote under the timer, and hides it when collapsed', () => {
    const vote: BoardVote = {
      session: voteSession(),
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
          source={{ store: new YjsDocumentStore(), origin: ADA }}
          canEdit
          createChime={() => ({ play: () => true, dispose: vi.fn() })}
        />
      </voteContext.Provider>,
    );
    expect(screen.getByRole('group', { name: 'Dot vote' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Facilitate' }));
    expect(screen.queryByRole('group', { name: 'Dot vote' })).toBeNull();
  });
});
