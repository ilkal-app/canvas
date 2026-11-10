import { describe, expect, it } from 'vitest';

import type { CollaboratorSummary } from './board-connection-status.js';
import {
  initialsOf,
  PRESENCE_AVATAR_SLOTS,
  presencePeopleOf,
  splitPresence,
  withoutPrincipal,
  type PresencePerson,
} from './presence-people.js';

/**
 * A collaborator.
 *
 * @param principalId - Their id.
 * @param name - Their name.
 * @param kind - Person or agent.
 * @returns The summary.
 */
function peer(
  principalId: string,
  name: string,
  kind: CollaboratorSummary['kind'] = 'user',
): CollaboratorSummary {
  return { principalId, kind, name, color: '#c77ddb' };
}

/**
 * `count` people, `p0` to `p<count - 1>`.
 *
 * @param count - How many.
 * @returns The entries.
 */
function people(count: number): PresencePerson[] {
  return presencePeopleOf([...Array(count).keys()].map((index) => peer(`p${String(index)}`, 'P')));
}

/**
 * The ids of entries.
 *
 * @param entries - The entries.
 * @returns Their principal ids.
 */
function ids(entries: readonly PresencePerson[]): string[] {
  return entries.map(({ principalId }) => principalId);
}

describe('initialsOf', () => {
  it('takes the first two letters of one word, and the first letter of two words', () => {
    expect(initialsOf('Mira')).toBe('MI');
    expect(initialsOf('jonas')).toBe('JO');
    expect(initialsOf('Ada Lovelace')).toBe('AL');
    expect(initialsOf('  Grace   Brewster Hopper ')).toBe('GB');
    expect(initialsOf('X')).toBe('X');
  });

  it('never cuts a code point in half, and says ? when there is nothing', () => {
    expect(initialsOf('\u{1F600}\u{1F601}\u{1F602}')).toBe('\u{1F600}\u{1F601}');
    expect(initialsOf('   ')).toBe('?');
    expect(initialsOf('')).toBe('?');
  });
});

describe('presencePeopleOf', () => {
  it('shows a principal once however many tabs, people before agents', () => {
    const entries = presencePeopleOf([
      peer('agent-1', 'Summariser', 'agent'),
      peer('jonas', 'Jonas'),
      peer('mira', 'Mira'),
      peer('mira', 'Mira'),
    ]);
    expect(ids(entries)).toEqual(['jonas', 'mira', 'agent-1']);
    expect(entries[0]).toEqual({
      principalId: 'jonas',
      kind: 'user',
      name: 'Jonas',
      initials: 'JO',
      color: '#c77ddb',
    });
  });

  it("names each person's page when it is known, and nothing otherwise", () => {
    const names = new Map([['page-2', 'Wireframes']]);
    const entries = presencePeopleOf(
      [
        { ...peer('jonas', 'Jonas'), page: 'page-2' },
        { ...peer('mira', 'Mira'), page: 'page-gone' },
        peer('noa', 'Noa'),
      ],
      (pageId) => names.get(pageId),
    );
    expect(entries.map((entry) => entry.pageName)).toEqual(['Wireframes', undefined, undefined]);
    expect('pageName' in (entries[1] ?? {})).toBe(false);
  });
});

describe('splitPresence (the overflow rule)', () => {
  it('shows everyone who fits, with no "+N"', () => {
    for (let count = 0; count <= PRESENCE_AVATAR_SLOTS; count += 1) {
      const { shown, rest } = splitPresence(people(count));
      expect(shown).toHaveLength(count);
      expect(rest).toEqual([]);
    }
  });

  it('turns the last slot into "+N" when more are on the board than fit', () => {
    const { shown, rest } = splitPresence(people(PRESENCE_AVATAR_SLOTS + 1));
    expect(ids(shown)).toEqual(['p0', 'p1', 'p2', 'p3']);
    expect(ids(rest)).toEqual(['p4', 'p5']);
  });

  it('keeps every entry exactly once, in order, whatever the count and the slots', () => {
    for (const slots of [1, 2, 3, 5, 8]) {
      for (let count = 0; count <= 12; count += 1) {
        const entries = people(count);
        const { shown, rest } = splitPresence(entries, slots);
        expect([...ids(shown), ...ids(rest)]).toEqual(ids(entries));
        expect(shown.length + (rest.length > 0 ? 1 : 0)).toBeLessThanOrEqual(slots);
        expect(rest.length === 0 || rest.length >= 2).toBe(true);
      }
    }
  });

  it('treats fewer than one slot as one: only the "+N"', () => {
    const { shown, rest } = splitPresence(people(3), 0);
    expect(shown).toEqual([]);
    expect(rest).toHaveLength(3);
  });
});

describe('withoutPrincipal', () => {
  const people = presencePeopleOf([
    peer('user-1', 'Ada'),
    peer('user-2', 'Grace'),
    peer('agent-1', 'Agent of Ada', 'agent'),
  ]);

  it('leaves out the signed-in person, whom the account button shows, and keeps agents', () => {
    expect(withoutPrincipal(people, 'user-1').map((person) => person.name)).toEqual([
      'Grace',
      'Agent of Ada',
    ]);
  });

  it('gives the same list back when nobody is left out, and never changes its input', () => {
    expect(withoutPrincipal(people, undefined)).toBe(people);
    expect(withoutPrincipal(people, 'user-9')).toBe(people);
    const before = [...people];
    withoutPrincipal(people, 'user-1');
    expect(people).toEqual(before);
  });
});
