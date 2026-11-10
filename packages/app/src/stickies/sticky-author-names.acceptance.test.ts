import { describe, expect, it } from 'vitest';

import { NO_STICKY_AUTHORS } from '@canvas/engine';

import type { BoardMembers } from '../service/board-people.js';

import { stickyAuthorNamesOf, stickyAuthorsOf } from './sticky-author-names.js';

const MEMBERS: BoardMembers = {
  members: [
    {
      userId: 'ada',
      name: '  Ada Lovelace  ',
      email: 'ada@example.test',
      pictureUrl: null,
      role: 'owner',
      addedAt: '2026-01-01T00:00:00Z',
    },
    {
      userId: 'gone',
      name: '  ',
      email: 'gone@example.test',
      pictureUrl: null,
      role: 'editor',
      addedAt: '2026-01-01T00:00:00Z',
    },
  ],
  agents: [{ keyId: 'key-1', name: 'Research agent', role: 'editor' }],
};

describe('sticky author names', () => {
  it('maps only member and agent principals to display names', () => {
    const names = stickyAuthorNamesOf(MEMBERS);
    expect([...names]).toEqual([
      ['user:ada', 'Ada Lovelace'],
      ['agent:agent-key:key-1', 'Research agent'],
    ]);
    expect(names.has('user:gone')).toBe(false);
    expect(names.has('agent:key-1')).toBe(false);
    expect(MEMBERS.members[0]?.name).toBe('  Ada Lovelace  ');
  });

  it('provides the former-member fallback when the member list can be read', () => {
    expect(stickyAuthorsOf(true, MEMBERS)).toEqual({
      isShown: true,
      names: stickyAuthorNamesOf(MEMBERS),
      fallback: 'Former member',
    });
    expect(stickyAuthorsOf(false, MEMBERS).isShown).toBe(false);
  });

  it.each([true, false])('shows no names or fallback without member access (%s)', (isShown) => {
    expect(stickyAuthorsOf(isShown, undefined)).toBe(NO_STICKY_AUTHORS);
  });
});
