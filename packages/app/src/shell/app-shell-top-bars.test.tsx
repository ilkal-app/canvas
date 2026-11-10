// @vitest-environment jsdom
// A design board, whose chrome is classic (D1).
// The shell's top bars: the board-name bar with its menu (grid, snapping, the shortcut
// sheet, the theme as three choices, the host's entries) and the presence/share bar, both before
// the canvas in the tab order, floating over it. In Chrome: tooling/scenario/specs/app/top-bars.spec.ts.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';
import { createFakeMount } from '../engine/__fixtures__/fake-mounted-engine.js';

import { AppShell, type AppShellProps } from './app-shell.js';

afterEach(cleanup);

/**
 * Renders the shell with a fake engine.
 *
 * @param props - More props.
 * @returns The engine the shell mounted and the shell's root.
 * @throws {Error} When the shell rendered no root element.
 */
function renderShell(props: Partial<AppShellProps> = {}) {
  localStorage.clear();
  const { mount, engines } = createFakeMount();
  const view = render(<AppShell mode="diagram" platform="mac" mountEngine={mount} {...props} />);
  const shellRoot = view.container.firstElementChild;
  if (!(shellRoot instanceof HTMLElement)) throw new Error('AppShell rendered no root element');
  return { engines, shellRoot };
}

/**
 * Opens the board menu with a click.
 *
 * @returns The menu.
 */
function openBoardMenu(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: 'Board menu' }));
  return screen.getByRole('menu', { name: 'Board menu' });
}

describe('AppShell top bars: the board-name bar', () => {
  it('shows the board’s name alone, with no mode line under it', () => {
    renderShell({ boardName: 'Q4 launch plan', mode: 'diagram' });
    const bar = screen.getByRole('group', { name: 'Board' });
    expect(within(bar).getByText('Q4 launch plan')).toBeTruthy();
    expect(bar.querySelector('[data-board-mode]')).toBeNull();
    // The board-name bar does not name the mode (item 3).
    expect(within(bar).queryByText('Diagram')).toBeNull();
    cleanup();
    renderShell();
    expect(screen.getByText('Untitled board')).toBeTruthy();
  });

  it('toggles the grid and snapping from the menu, checked while on', () => {
    const { engines } = renderShell();
    let menu = openBoardMenu();
    const grid = within(menu).getByRole('menuitemcheckbox', { name: 'Grid' });
    expect(grid.getAttribute('aria-checked')).toBe('false');
    expect(
      within(menu).getByRole('menuitemcheckbox', { name: 'Snapping' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(document.activeElement).toBe(within(menu).getAllByRole('menuitemcheckbox')[0]);
    fireEvent.click(grid);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(engines[0]?.viewPreferences.at(-1)).toMatchObject({ isGridVisible: true });
    menu = openBoardMenu();
    expect(
      within(menu).getByRole('menuitemcheckbox', { name: 'Grid' }).getAttribute('aria-checked'),
    ).toBe('true');
    fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'Snapping' }));
    expect(engines[0]?.viewPreferences.at(-1)).toMatchObject({ isSnappingOn: false });
  });

  it('opens the shortcut sheet from the menu', () => {
    renderShell();
    fireEvent.click(within(openBoardMenu()).getByRole('menuitem', { name: /Keyboard shortcuts/ }));
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
  });

  it('offers the three themes directly, the one in use checked', () => {
    const { shellRoot } = renderShell({ initialThemePreference: 'dark' });
    const menu = openBoardMenu();
    const theme = within(menu).getByRole('group', { name: 'Theme' });
    const choices = within(theme).getAllByRole('menuitemradio');
    expect(choices.map((choice) => choice.textContent)).toEqual(['Graphite', 'Vellum', 'System']);
    expect(choices.map((choice) => choice.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'false',
    ]);
    fireEvent.click(within(theme).getByRole('menuitemradio', { name: 'Vellum' }));
    expect(shellRoot.dataset.theme).toBe('light');
    const again = within(openBoardMenu()).getByRole('menuitemradio', { name: 'Vellum' });
    expect(again.getAttribute('aria-checked')).toBe('true');
  });

  it('works by keyboard: arrows move, Escape closes back on the button', () => {
    renderShell({
      boardBar: { menuEntries: [{ id: 'history', label: 'History', onSelect: vi.fn() }] },
    });
    const button = screen.getByRole('button', { name: 'Board menu' });
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    fireEvent.keyDown(button, { key: 'ArrowUp' });
    const menu = screen.getByRole('menu');
    const items = [...menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
    expect(items.map((item) => item.textContent)).toEqual([
      'History',
      'Grid',
      'Snapping',
      'Keyboard shortcuts?',
      'Graphite',
      'Vellum',
      'System',
    ]);
    expect(document.activeElement).toBe(items.at(-1));
    fireEvent.keyDown(document.activeElement ?? menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(document.activeElement ?? menu, { key: 'End' });
    expect(document.activeElement).toBe(items.at(-1));
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      document.activeElement?.dispatchEvent(escape);
    });
    expect(escape.defaultPrevented).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('runs the host’s entries, and closes on a press outside', () => {
    const onSelect = vi.fn();
    renderShell({ boardBar: { menuEntries: [{ id: 'history', label: 'History', onSelect }] } });
    fireEvent.click(within(openBoardMenu()).getByRole('menuitem', { name: 'History' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    openBoardMenu();
    fireEvent.pointerDown(screen.getByRole('main', { name: 'Canvas' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('AppShell top bars: the presence/share bar', () => {
  it('shows with a connection and the host’s Share, both bars before the canvas', () => {
    const onShare = vi.fn();
    renderShell({ connection: new FakeBoardConnection('demo'), onShare });
    const presence = screen.getByRole('group', { name: 'Presence and sharing' });
    expect(within(presence).getByRole('status', { name: 'Connection: Connected' })).toBeTruthy();
    fireEvent.click(within(presence).getByRole('button', { name: 'Share' }));
    expect(onShare).toHaveBeenCalledTimes(1);
    const canvas = screen.getByRole('main', { name: 'Canvas' });
    for (const bar of [screen.getByRole('group', { name: 'Board' }), presence]) {
      expect(bar.compareDocumentPosition(canvas) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('is absent with neither a connection nor a Share', () => {
    renderShell();
    expect(screen.queryByRole('group', { name: 'Presence and sharing' })).toBeNull();
  });

  it('keeps the connection’s state live while the layout is inert, Share and the board bar not', () => {
    renderShell({ connection: new FakeBoardConnection('demo'), onShare: vi.fn(), isInert: true });
    const status = screen.getByRole('status', { name: 'Connection: Connected' });
    expect(status.closest('[inert]')).toBeNull();
    expect(screen.getByText('Share').closest('[inert]')).not.toBeNull();
    expect(
      screen.getByRole('button', { name: 'Board menu', hidden: true }).closest('[inert]'),
    ).not.toBeNull();
    expect(
      screen.getByRole('main', { name: 'Canvas', hidden: true }).closest('[inert]'),
    ).not.toBeNull();
  });

  it('hides when the host shows its own connection feedback', () => {
    renderShell({
      connection: new FakeBoardConnection('demo'),
      shouldShowConnectionFeedback: false,
    });
    expect(screen.queryByRole('status', { name: /^Connection/ })).toBeNull();
  });
});

describe('AppShell top bars: the wheel', () => {
  it('hands a wheel over the bars to the canvas, so they never stop the camera', () => {
    renderShell();
    const canvas = screen.getByRole('main', { name: 'Canvas' }).querySelector('canvas');
    if (canvas === null) throw new Error('no canvas');
    const received: WheelEvent[] = [];
    canvas.addEventListener('wheel', (event) => received.push(event));
    const wheel = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX: 60,
      clientY: 40,
      deltaY: -69,
      ctrlKey: true,
    });
    screen.getByRole('group', { name: 'Board' }).dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ clientX: 60, clientY: 40, deltaY: -69, ctrlKey: true });
  });

  it('leaves a wheel over the board menu to the menu', () => {
    renderShell();
    const canvas = screen.getByRole('main', { name: 'Canvas' }).querySelector('canvas');
    const received: WheelEvent[] = [];
    canvas?.addEventListener('wheel', (event) => received.push(event));
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 40 });
    openBoardMenu().dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
    expect(received).toEqual([]);
  });
});

describe('AppShell top bars and the dock', () => {
  it('keeps the tools in the dock, out of the top bars, inert with the rest while the cheat sheet is open', () => {
    // The old toolbar is gone; its tools are the dock's, its toggles the board menu's.
    renderShell({ onShare: vi.fn() });
    const share = screen.getByRole('button', { name: 'Share' });
    const boardBar = screen.getByRole('group', { name: 'Board' });
    const tools = screen.getByRole('toolbar', { name: 'Tools' });
    expect(boardBar.contains(tools)).toBe(false);
    expect(screen.queryByRole('button', { name: 'Shortcuts' })).toBeNull();
    fireEvent.keyDown(document.body, { key: '?' });
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
    expect(boardBar.closest('[inert]')).not.toBeNull();
    expect(tools.closest('[inert]')).not.toBeNull();
    expect(share.closest('[inert]')).not.toBeNull();
  });
});

describe('AppShell top bars: the live board loading', () => {
  it('says the saved copy shows and the live board loads, with a progress line, until it is in', () => {
    const connection = new FakeBoardConnection('demo');
    connection.setState('connecting');
    renderShell({ connection, mode: 'diagram' });
    const boardBar = screen.getByRole('group', { name: 'Board' });
    expect(within(boardBar).getByText('Saved copy · loading the live board…')).toBeTruthy();
    // No mode line, while loading or after (item 3).
    expect(boardBar.querySelector('[data-board-mode]')).toBeNull();
    const state = screen.getByRole('status', { name: 'Connection: Connecting…' });
    expect(state.textContent).toBe('Connecting');
    const progress = screen.getByRole('progressbar', { name: 'Loading the live board' });
    // Indeterminate: no value.
    expect(progress.getAttribute('aria-valuenow')).toBeNull();
    act(() => {
      connection.setState('connected');
    });
    expect(within(boardBar).queryByText('Saved copy · loading the live board…')).toBeNull();
    expect(within(boardBar).queryByText('Whiteboard')).toBeNull();
    expect(state.textContent).toBe('Live');
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('is not shown for a board the shell holds without a connection', () => {
    renderShell({ boardName: 'Plans' });
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText('Saved copy · loading the live board…')).toBeNull();
  });
});

describe('AppShell top bars: offline', () => {
  const offlineMessage =
    'You’re offline. Edits are kept on this device and sync when you reconnect.';

  /**
   * A connection that counts Retry now.
   *
   * @returns The connection and its count.
   */
  function retryingConnection(): { connection: FakeBoardConnection; retries: () => number } {
    const connection = new FakeBoardConnection('demo');
    let count = 0;
    Object.assign(connection, {
      retryNow: () => {
        count += 1;
      },
    });
    return { connection, retries: () => count };
  }

  // Item 4 (of 2026-10-07): the banner is a toast in the one region,
  // over the dock in the shell's toast home, not under the bars. Rewritten, assertions kept: its
  // words, the polite region, Retry now and its count, the words changing for a dropped relay,
  // gone when connected; no region at rest (rather than an empty one); and Retry now outside the
  // inert layout, so reachable while it is inert (rather than inert with it: the region is
  // outside the layout, and inside an open dialog).
  it('shows the banner over the dock while offline or reconnecting, and Retry now reconnects', () => {
    const { connection, retries } = retryingConnection();
    const { shellRoot } = renderShell({ connection, onShare: vi.fn() });
    const bars = shellRoot.querySelector('[data-top-bars]');
    const home = shellRoot.querySelector('[data-toast-home]');
    expect(screen.queryByRole('status', { name: 'Board sync' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry now' })).toBeNull();
    act(() => {
      connection.setState('offline');
    });
    const region = screen.getByRole('status', { name: 'Board sync' });
    expect(region.textContent).toBe(offlineMessage);
    expect(screen.getByRole('status', { name: 'Connection: Offline' }).textContent).toBe('Offline');
    const retry = screen.getByRole('button', { name: 'Retry now' });
    expect(home?.contains(retry)).toBe(true);
    expect(bars?.contains(retry)).toBe(false);
    fireEvent.click(retry);
    expect(retries()).toBe(1);
    // Reconnecting (item 6), the banner says the connection dropped: its words change,
    // so it is announced again.
    act(() => {
      connection.setState('reconnecting');
    });
    expect(screen.getByRole('status', { name: 'Board sync' }).textContent).toBe(
      'Connection dropped. Reconnecting…',
    );
    expect(screen.getByRole('button', { name: 'Retry now' })).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Connection: Reconnecting…' })).toBeTruthy();
    act(() => {
      connection.setState('connected');
    });
    expect(screen.queryByRole('status', { name: 'Board sync' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry now' })).toBeNull();
  });

  it('keeps Retry now after the canvas, outside the layout, reachable while it is inert', () => {
    const { connection } = retryingConnection();
    connection.setState('offline');
    renderShell({ connection, onShare: vi.fn() });
    const retry = screen.getByRole('button', { name: 'Retry now' });
    const share = screen.getByRole('button', { name: 'Share' });
    const canvas = screen.getByRole('main', { name: 'Canvas' });
    expect(share.compareDocumentPosition(retry) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(canvas.compareDocumentPosition(retry) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(retry.closest('[inert]')).toBeNull();
    cleanup();
    renderShell({ connection, onShare: vi.fn(), isInert: true });
    expect(screen.getByText(offlineMessage).closest('[inert]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry now' }).closest('[inert]')).toBeNull();
  });

  it('offers no Retry now on a connection that cannot reconnect, and no banner on a local board', () => {
    const connection = new FakeBoardConnection('demo');
    connection.setState('offline');
    renderShell({ connection });
    expect(screen.getByText(offlineMessage)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry now' })).toBeNull();
    cleanup();
    const local = { ...connection.status(), isLocalOnly: true, isSavedOnDevice: true };
    renderShell({
      connection: {
        store: connection.store,
        origin: connection.origin,
        status: () => local,
        subscribe: () => () => undefined,
        dismissStrandedEdits: () => undefined,
        destroy: () => undefined,
      },
    });
    expect(screen.queryByText(offlineMessage)).toBeNull();
    expect(screen.getByRole('status', { name: 'Connection: Offline · local board' })).toBeTruthy();
  });
});
