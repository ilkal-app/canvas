// @vitest-environment jsdom
// Floating shell integration; the classic menu keeps its existing controls.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';
import { createFakeMount } from '../engine/__fixtures__/fake-mounted-engine.js';

import { AppShell } from './app-shell.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('floating board menu in the shell', () => {
  it('shows its entries, excludes deferred controls, and closes after a host action', () => {
    const onRename = vi.fn();
    const onVersionHistory = vi.fn();
    const onShare = vi.fn();
    const onBoardSettings = vi.fn();
    const onDelete = vi.fn();
    render(
      <AppShell
        platform="mac"
        mountEngine={createFakeMount().mount}
        connection={new FakeBoardConnection('demo')}
        helpLinks={{ docsUrl: '/help', feedbackUrl: 'mailto:feedback@example.com' }}
        boardBar={{
          homeHref: '/',
          onNavigateHome: vi.fn(),
          floatingMenu: { onRename, onVersionHistory, onShare, onBoardSettings, onDelete },
        }}
      />,
    );
    const trigger = screen
      .getByRole('group', { name: 'Board' })
      .querySelector('[aria-label="Board menu"]');
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('No board menu trigger');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const menu = screen.getByRole('menu', { name: 'Board menu' });
    for (const name of [
      'All boards',
      'Rename',
      'Version history',
      'Share and permissions',
      'Board settings',
      'Theme',
      'Keyboard shortcuts',
      'Help and feedback',
      'Delete board',
    ]) {
      expect(within(menu).getByRole('menuitem', { name: new RegExp(`^${name}`) })).toBeTruthy();
    }
    for (const name of ['Grid', 'Snapping', 'Comments', 'Duplicate', 'Export']) {
      expect(within(menu).queryByText(name)).toBeNull();
    }
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Rename' }));
    expect(onRename).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu', { name: 'Board menu' })).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('changes the shell theme through the Theme submenu', () => {
    render(
      <AppShell
        platform="mac"
        mountEngine={createFakeMount().mount}
        connection={new FakeBoardConnection('demo')}
        boardBar={{ homeHref: '/', onNavigateHome: vi.fn(), floatingMenu: {} }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Board menu' }));
    fireEvent.click(
      within(screen.getByRole('menu', { name: 'Board menu' })).getByRole('menuitem', {
        name: /^Theme/,
      }),
    );
    fireEvent.click(
      within(screen.getByRole('menu', { name: 'Theme' })).getByRole('menuitemradio', {
        name: 'Dark (Graphite)',
      }),
    );
    expect(document.querySelector('[data-theme="dark"]')).toBeTruthy();
    expect(screen.queryByRole('menu', { name: 'Board menu' })).toBeNull();
  });

  it('keeps Grid and Snapping checkboxes in the classic menu', () => {
    render(<AppShell platform="mac" mode="diagram" mountEngine={createFakeMount().mount} />);
    fireEvent.click(screen.getByRole('button', { name: 'Board menu' }));
    const menu = screen.getByRole('menu', { name: 'Board menu' });
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'Grid' })).toBeTruthy();
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'Snapping' })).toBeTruthy();
  });
});
