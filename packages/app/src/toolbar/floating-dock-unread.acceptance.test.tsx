// CONTRACT: the floating Comment tool exposes an unread dot and an accessible count
// for one or many unread threads.
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { commentContext } from '../comments/comment-context.js';
import { createFloatingShortcutRegistry } from '../keymap/floating-keymap.js';
import { INITIAL_SHELL_STATE } from '../state/shell-reducer.js';

import { writer } from './__fixtures__/render-dock.js';
import { FloatingDock } from './floating-dock.js';

afterEach(cleanup);

for (const count of [1, 4]) {
  it(`names ${String(count)} unread thread${count === 1 ? '' : 's'} and shows one dot`, () => {
    render(
      <commentContext.Provider value={{ ...writer(), unread: { threads: count, mentions: 0 } }}>
        <FloatingDock
          registry={createFloatingShortcutRegistry('mac')}
          state={{ ...INITIAL_SHELL_STATE, canEdit: true }}
          dispatch={vi.fn()}
        />
      </commentContext.Provider>,
    );
    expect(
      screen.getByRole('button', { name: new RegExp(`^Comment, ${String(count)} unread`) }),
    ).toBeTruthy();
    expect(document.querySelectorAll('[data-unread-dot]')).toHaveLength(1);
  });
}
