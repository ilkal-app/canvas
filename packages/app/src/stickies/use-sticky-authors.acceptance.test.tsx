// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SYSTEM_ORIGIN, YjsDocumentStore } from '@canvas/document';
import { NO_STICKY_AUTHORS, type StickyAuthors } from '@canvas/engine';

import type { BoardMembers } from '../service/board-people.js';

import { useStickyAuthors } from './use-sticky-authors.js';

const MEMBERS: BoardMembers = {
  members: [
    {
      userId: 'ada',
      name: 'Ada',
      email: 'ada@example.test',
      pictureUrl: null,
      role: 'owner',
      addedAt: '2026-01-01T00:00:00Z',
    },
  ],
  agents: [],
};

afterEach(cleanup);

/** The first hook's props. */
interface MembersProps {
  readonly members: BoardMembers | undefined;
}

/** The second hook's props. */
interface MountProps extends MembersProps {
  readonly isMounted: boolean;
}

const membersProps: MembersProps = { members: MEMBERS };
const mountProps: MountProps = { isMounted: false, members: MEMBERS };

describe('useStickyAuthors', () => {
  it('sends initial state, setting changes, and new members without sending on identical renders', () => {
    const store = new YjsDocumentStore();
    const setStickyAuthors = vi.fn<(authors: StickyAuthors) => void>();
    const engine = { setStickyAuthors };
    const { rerender, unmount } = renderHook(
      ({ members }: MembersProps) => {
        useStickyAuthors(engine, store, members);
      },
      { initialProps: membersProps },
    );
    expect(setStickyAuthors).toHaveBeenCalledExactlyOnceWith({
      isShown: false,
      names: new Map([['user:ada', 'Ada']]),
      fallback: 'Former member',
    });
    const firstNames = setStickyAuthors.mock.calls[0]?.[0].names;
    rerender({ members: MEMBERS });
    expect(setStickyAuthors).toHaveBeenCalledTimes(1);

    act(() => {
      store.transact(SYSTEM_ORIGIN, (transaction) => {
        transaction.setStickyAuthors(true);
      });
    });
    expect(setStickyAuthors).toHaveBeenCalledTimes(2);
    expect(setStickyAuthors.mock.calls[1]?.[0]).toMatchObject({ isShown: true });
    expect(setStickyAuthors.mock.calls[1]?.[0].names).toBe(firstNames);

    const renamed: BoardMembers = {
      ...MEMBERS,
      members: MEMBERS.members.map((member) => ({ ...member, name: 'Ada Byron' })),
    };
    rerender({ members: renamed });
    expect(setStickyAuthors).toHaveBeenCalledTimes(3);
    expect(setStickyAuthors.mock.calls[2]?.[0].names.get('user:ada')).toBe('Ada Byron');
    rerender({ members: renamed });
    expect(setStickyAuthors).toHaveBeenCalledTimes(3);

    unmount();
    act(() => {
      store.transact(SYSTEM_ORIGIN, (transaction) => {
        transaction.setStickyAuthors(false);
      });
    });
    expect(setStickyAuthors).toHaveBeenCalledTimes(3);
  });

  it('hides names when member access is lost and waits for an engine when absent', () => {
    const store = new YjsDocumentStore();
    const setStickyAuthors = vi.fn<(authors: StickyAuthors) => void>();
    const engine = { setStickyAuthors };
    const { rerender } = renderHook(
      ({ isMounted, members }: MountProps) => {
        useStickyAuthors(isMounted ? engine : undefined, store, members);
      },
      { initialProps: mountProps },
    );
    expect(setStickyAuthors).not.toHaveBeenCalled();
    rerender({ isMounted: true, members: MEMBERS });
    expect(setStickyAuthors).toHaveBeenCalledTimes(1);
    rerender({ isMounted: true, members: undefined });
    expect(setStickyAuthors).toHaveBeenLastCalledWith(NO_STICKY_AUTHORS);
    rerender({ isMounted: true, members: undefined });
    expect(setStickyAuthors).toHaveBeenCalledTimes(2);
  });
});
