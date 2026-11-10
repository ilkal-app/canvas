// @vitest-environment jsdom
// The floating board bar's DOM contract; layout is checked in browser scenarios.
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

/**
 * Mounts the shell with the fake engine and returns its board bar.
 *
 * @param props - Optional host navigation.
 * @param props.homeHref - The host's board-list address.
 * @param props.editedAt - When the host's board was last edited.
 * @param props.onNavigateHome - The host's in-app navigation callback.
 * @returns The board bar.
 */
function renderBoardBar(
  props: {
    readonly homeHref?: string;
    readonly onNavigateHome?: () => void;
    readonly editedAt?: string;
  } = {},
) {
  render(
    <AppShell
      platform="mac"
      mountEngine={createFakeMount().mount}
      connection={new FakeBoardConnection('demo')}
      boardBar={props}
    />,
  );
  return screen.getByRole('group', { name: 'Board' });
}

describe('floating board bar', () => {
  it('uses the bar sheet and fallback heading, with no subtitle before an edit, without a host', () => {
    const bar = renderBoardBar();
    expect(bar.getAttribute('data-top-bar')).toBe('board');
    expect(bar.hasAttribute('data-floating-sheet')).toBe(true);
    expect(bar.getAttribute('data-shape')).toBe('bar');
    expect(within(bar).getByRole('heading', { level: 1, name: 'demo' }).getAttribute('title')).toBe(
      'demo',
    );
    // The mode stays internal: no "Whiteboard", and no "Edited …" for no known edit.
    expect(within(bar).queryByText('Whiteboard')).toBeNull();
    expect(within(bar).queryByText(/^Edited /u)).toBeNull();
    expect(within(bar).queryByRole('link', { name: 'All boards' })).toBeNull();
    expect(within(bar).queryByRole('button', { name: 'Rename the board' })).toBeNull();
  });

  it("says when the host's board was last edited, under its name", () => {
    const bar = renderBoardBar({ editedAt: new Date().toISOString() });
    expect(within(bar).getByText('Edited just now', { exact: true })).toBeTruthy();
  });

  it('uses the host home link and routes a plain click through the callback', () => {
    const onNavigateHome = vi.fn();
    const bar = renderBoardBar({ homeHref: '/', onNavigateHome });
    const home = within(bar).getByRole('link', { name: 'All boards' });
    expect(home.getAttribute('href')).toBe('/');
    fireEvent.click(home);
    expect(onNavigateHome).toHaveBeenCalledOnce();
  });

  it('toggles search and opens the existing board menu', () => {
    const bar = renderBoardBar();
    const search = within(bar).getByRole('button', { name: 'Search board' });
    expect(search.getAttribute('aria-haspopup')).toBe('dialog');
    expect(search.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(search);
    expect(search.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(search);
    expect(search.getAttribute('aria-expanded')).toBe('false');
    const menu = within(bar).getByRole('button', { name: 'Board menu' });
    expect(menu.getAttribute('aria-haspopup')).toBe('menu');
    fireEvent.click(menu);
    expect(screen.getByRole('menu', { name: 'Board menu' })).toBeTruthy();
  });

  it('keeps the classic bar when the classic chrome is named', () => {
    render(<AppShell platform="mac" mode="diagram" mountEngine={createFakeMount().mount} />);
    const bar = screen.getByRole('group', { name: 'Board' });
    expect(bar.getAttribute('data-top-bar')).toBe('board');
    expect(bar.getAttribute('data-shape')).not.toBe('bar');
    expect(within(bar).getByText('Untitled board', { exact: true })).toBeTruthy();
  });
});
