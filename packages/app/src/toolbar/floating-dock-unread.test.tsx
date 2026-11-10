// @vitest-environment jsdom
// The floating dock's Comment carries an accent dot, and says how many, while
// comment threads are unread for the person.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { commentContext } from '../comments/comment-context.js';
import type { UnreadComments } from '../comments/comment-unread.js';
import { createFloatingShortcutRegistry } from '../keymap/floating-keymap.js';
import { INITIAL_SHELL_STATE } from '../state/shell-reducer.js';

import { writer } from './__fixtures__/render-dock.js';
import { FloatingDock } from './floating-dock.js';

afterEach(cleanup);

/**
 * An editor's floating dock under comments with the given unread counts.
 *
 * @param unread - The unread counts; none if absent.
 */
function show(unread?: UnreadComments): void {
  render(
    <commentContext.Provider value={{ ...writer(), ...(unread === undefined ? {} : { unread }) }}>
      <FloatingDock
        registry={createFloatingShortcutRegistry('mac')}
        state={{ ...INITIAL_SHELL_STATE, canEdit: true }}
        dispatch={vi.fn()}
      />
    </commentContext.Provider>,
  );
}

it('dots Comment and names its unread threads while any is unread', () => {
  show({ threads: 3, mentions: 1 });
  const comment = screen.getByRole('button', { name: /^Comment, 3 unread/ });
  expect(comment.parentElement?.querySelector('[data-unread-dot]')).not.toBeNull();
  expect(document.querySelectorAll('[data-unread-dot]')).toHaveLength(1);
});

it('has no dot with nothing unread, or without counts', () => {
  show({ threads: 0, mentions: 0 });
  expect(screen.getByRole('button', { name: /^Comment/ }).getAttribute('aria-label')).not.toContain(
    'unread',
  );
  expect(document.querySelector('[data-unread-dot]')).toBeNull();
  cleanup();
  show();
  expect(document.querySelector('[data-unread-dot]')).toBeNull();
});
