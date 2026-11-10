// @vitest-environment jsdom
// The account button at the presence/share bar's right end (item 7). Its place and the
// stacking of its menu over the drawers, in Chrome: tooling/scenario/specs/site/top-bars.spec.ts.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccountMenu, type ShellAccount } from './account-menu.js';

afterEach(cleanup);

/**
 * An account whose entries the test watches.
 *
 * @returns The account.
 */
function fakeAccount(): ShellAccount & {
  readonly onSettings: ReturnType<typeof vi.fn>;
  readonly onBoards: ReturnType<typeof vi.fn>;
  readonly onSignOut: ReturnType<typeof vi.fn>;
} {
  return {
    principalId: 'user-1',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    onSettings: vi.fn(),
    onBoards: vi.fn(),
    onSignOut: vi.fn(),
  };
}

describe('AccountMenu', () => {
  it('is the person’s own avatar, named “Account: <name>”, a menu button', () => {
    render(<AccountMenu account={fakeAccount()} />);
    const button = screen.getByRole('button', { name: 'Account: Ada Lovelace' });
    expect(button.textContent).toBe('AL');
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.tabIndex).toBe(0);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens under the name and email with Settings, Your boards and Sign out', () => {
    render(<AccountMenu account={fakeAccount()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Account: Ada Lovelace' }));
    const menu = screen.getByRole('menu', { name: 'Account' });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Settings', 'Your boards', 'Sign out']);
    const identity = document.getElementById(menu.getAttribute('aria-describedby') ?? '');
    expect(identity?.textContent).toBe('Ada Lovelaceada@example.com');
    expect(document.activeElement).toBe(within(menu).getAllByRole('menuitem')[0]);
  });

  it.each([
    ['Settings', 'onSettings'],
    ['Your boards', 'onBoards'],
    ['Sign out', 'onSignOut'],
  ] as const)('runs %s once, after closing the menu', (name, handler) => {
    const account = fakeAccount();
    render(<AccountMenu account={account} />);
    fireEvent.click(screen.getByRole('button', { name: 'Account: Ada Lovelace' }));
    fireEvent.click(screen.getByRole('menuitem', { name }));
    expect(account[handler]).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    for (const other of ['onSettings', 'onBoards', 'onSignOut'] as const) {
      if (other !== handler) expect(account[other]).not.toHaveBeenCalled();
    }
  });

  it('works by keyboard: Arrow Up opens on Sign out, the arrows wrap, Escape closes back', () => {
    const account = fakeAccount();
    render(<AccountMenu account={account} />);
    const button = screen.getByRole('button', { name: 'Account: Ada Lovelace' });
    button.focus();
    fireEvent.keyDown(button, { key: 'ArrowUp' });
    const items = screen.getAllByRole('menuitem');
    expect(document.activeElement).toBe(items.at(-1));
    fireEvent.keyDown(document.activeElement ?? button, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(document.activeElement ?? button, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(document.activeElement ?? button, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Settings' }));
    fireEvent.click(document.activeElement ?? button);
    expect(account.onSettings).toHaveBeenCalledTimes(1);
  });
});
