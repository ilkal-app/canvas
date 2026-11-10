// @vitest-environment jsdom
// CONTRACT: the floating board menu lets a viewer toggle resolved pins on and off twice.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import { commentContext } from '../comments/comment-context.js';
import { createFakeMount } from '../engine/__fixtures__/fake-mounted-engine.js';

import { AppShell } from './app-shell.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const mountEngine = createFakeMount().mount;

function ViewerBoard() {
  const [isResolvedShown, setResolvedShown] = useState(false);
  return (
    <commentContext.Provider
      value={{
        canWrite: false,
        isPlacing: false,
        isPanelOpen: false,
        setPlacing: vi.fn(),
        togglePanel: vi.fn(),
        isResolvedShown,
        toggleResolvedShown: () => {
          setResolvedShown((wasShown) => !wasShown);
        },
      }}
    >
      <AppShell
        platform="mac"
        mountEngine={mountEngine}
        boardBar={{ homeHref: '/', onNavigateHome: vi.fn(), floatingMenu: {} }}
      />
    </commentContext.Provider>
  );
}

it('shows the checkbox to a viewer and returns it to unchecked after two choices', () => {
  render(<ViewerBoard />);
  const choose = (expected: string) => {
    fireEvent.click(screen.getByRole('button', { name: 'Board menu' }));
    const item = within(screen.getByRole('menu', { name: 'Board menu' })).getByRole(
      'menuitemcheckbox',
      { name: 'Show resolved comments' },
    );
    expect(item.getAttribute('aria-checked')).toBe(expected);
    fireEvent.click(item);
  };
  choose('false');
  choose('true');
  fireEvent.click(screen.getByRole('button', { name: 'Board menu' }));
  expect(
    within(screen.getByRole('menu', { name: 'Board menu' }))
      .getByRole('menuitemcheckbox', { name: 'Show resolved comments' })
      .getAttribute('aria-checked'),
  ).toBe('false');
});
