// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PresenceAvatars } from './presence-avatars.js';
import type { PresencePerson } from './presence-people.js';

afterEach(() => {
  cleanup();
});

/**
 * An entry of the presence bar.
 *
 * @param name - The name.
 * @param kind - Person or agent.
 * @param pageName - The page they are on, if known.
 * @returns The entry.
 */
function person(name: string, kind: PresencePerson['kind'] = 'user', pageName?: string) {
  return {
    principalId: name.toLowerCase(),
    kind,
    name,
    initials: name.slice(0, 2).toUpperCase(),
    color: '#c77ddb',
    ...(pageName === undefined ? {} : { pageName }),
  } satisfies PresencePerson;
}

describe('PresenceAvatars', () => {
  it("names a person's page, and marks an agent in the overflow list", () => {
    const people = [
      person('Ada', 'user', 'Wireframes'),
      person('Bea'),
      person('Cy'),
      person('Dee'),
      person('Eve'),
      person('Scribe', 'agent', 'Notes'),
    ];
    render(<PresenceAvatars people={people} />);
    expect(screen.getByRole('img', { name: 'Ada, on Wireframes' }).title).toBe(
      'Ada, on Wireframes',
    );
    fireEvent.click(screen.getByRole('button', { name: '2 more on this board' }));
    const list = screen.getByRole('listbox', { name: 'Also on this board' });
    const agent = within(list).getByRole('option', { name: /Scribe/ });
    expect(within(agent).getByText('Agent')).toBeDefined();
    expect(within(list).getByRole('option', { name: 'Eve' })).toBeDefined();
  });
});
