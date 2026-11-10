import { describe, expect, it } from 'vitest';

import type { PresenceState } from '@canvas/collab';

import { collaboratorsOf } from './board-connection-status.js';

/**
 * A remote client's presence.
 *
 * @param id - Its principal id.
 * @param name - Its display name.
 * @returns The state.
 */
function presenceOf(id: string, name: string): PresenceState {
  return { principal: { id, kind: 'user', name, color: '#000000' }, updatedAt: 0 };
}

describe('collaboratorsOf', () => {
  it('lists every client by principal, then name', () => {
    const snapshot = new Map([
      [1, presenceOf('guest-b', 'b')],
      [2, presenceOf('guest-a', 'second tab')],
      [3, presenceOf('guest-a', 'first tab')],
    ]);
    expect(
      collaboratorsOf(snapshot).map(({ principalId, name }) => `${principalId}/${name}`),
    ).toEqual(['guest-a/first tab', 'guest-a/second tab', 'guest-b/b']);
  });

  it('carries the text a collaborator edits, and nothing for one who edits none', () => {
    const editing = { objectId: 'note-1', anchor: 1, focus: 4 };
    const snapshot = new Map([
      [1, { ...presenceOf('guest-a', 'Ada'), editing }],
      [2, presenceOf('guest-b', 'Bea')],
    ]);
    const [ada, bea] = collaboratorsOf(snapshot);
    expect(ada?.editing).toEqual(editing);
    expect(bea !== undefined && 'editing' in bea).toBe(false);
  });

  it('shows the principal id for a collaborator whose name is empty', () => {
    const snapshot = new Map([
      [1, presenceOf('guest-a', '')],
      [2, presenceOf('guest-b', 'Bea')],
    ]);
    expect(collaboratorsOf(snapshot).map(({ name }) => name)).toEqual(['guest-a', 'Bea']);
  });
});
