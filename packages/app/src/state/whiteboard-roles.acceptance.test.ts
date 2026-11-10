// CONTRACT: the role table is kept, and commenters have Comment again.
import { describe, expect, it } from 'vitest';

import {
  FLOATING_READ_ONLY_TOOLS,
  floatingDockToolsFor,
  floatingToolAvailability,
} from './floating-dock.js';
import { WHITEBOARD_ROLE_SHELL } from './whiteboard-roles.js';

describe('whiteboard role shell', () => {
  it('records the approved viewer and commenter shell', () => {
    expect(WHITEBOARD_ROLE_SHELL).toEqual({
      viewer: {
        dockTools: ['select', 'pan'],
        popover: 'none',
        canVote: false,
        menu: ['allBoards', 'theme', 'shortcuts', 'boardSettings'],
      },
      commenter: {
        dockTools: ['select', 'pan', 'comment', 'reactions'],
        popover: 'comment',
        canVote: false,
        menu: ['allBoards', 'theme', 'shortcuts', 'boardSettings'],
      },
    });
  });

  it('uses the table for read-only dock tools and their availability', () => {
    const shells = WHITEBOARD_ROLE_SHELL as Readonly<
      Record<'viewer' | 'commenter', { readonly dockTools: readonly string[] }>
    >;
    for (const role of ['viewer', 'commenter'] as const) {
      expect(FLOATING_READ_ONLY_TOOLS[role]).toEqual(shells[role].dockTools);
      expect(floatingDockToolsFor(role)).toEqual(shells[role].dockTools);
      expect(floatingToolAvailability('select', role)).toEqual({ isAvailable: true });
      expect(floatingToolAvailability('pan', role)).toEqual({ isAvailable: true });
    }
    expect(floatingToolAvailability('reactions', 'viewer').isAvailable).toBe(false);
    expect(floatingToolAvailability('reactions', 'commenter')).toEqual({ isAvailable: true });
  });

  it('offers Comment to a commenter but not a viewer', () => {
    expect(floatingToolAvailability('comment', 'commenter')).toEqual({ isAvailable: true });
    expect(floatingToolAvailability('comment', 'viewer').isAvailable).toBe(false);
  });
});
