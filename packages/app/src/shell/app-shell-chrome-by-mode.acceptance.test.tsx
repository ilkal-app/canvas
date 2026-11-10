// @vitest-environment jsdom
// Step 0: floating chrome belongs to whiteboard boards, including after a live mode change.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { BoardMode } from '@canvas/schema';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';
import { createFakeMount } from '../engine/__fixtures__/fake-mounted-engine.js';
import { ICON_PATHS } from '../icons/icon-paths.js';
import { LIBRARY_ICON_PATHS } from '../icons/library-icon-paths.js';

import { AppShell } from './app-shell.js';
import { useWhiteboardChrome } from './whiteboard-chrome.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function ChromeReader() {
  return <output data-testid="effective-chrome">{useWhiteboardChrome()}</output>;
}

function renderShell(mode: BoardMode) {
  const { mount, engines } = createFakeMount();
  const connection = new FakeBoardConnection('demo');
  const shell = (shownMode: BoardMode) => (
    <AppShell
      platform="mac"
      mountEngine={mount}
      connection={connection}
      boardName="Plans"
      mode={shownMode}
      boardBar={{ title: <ChromeReader /> }}
    />
  );
  const view = render(shell(mode));
  const root = view.container.firstElementChild;
  if (!(root instanceof HTMLElement)) throw new Error('AppShell rendered no root');
  const engine = engines[0];
  if (engine === undefined) throw new Error('AppShell mounted no engine');
  return {
    ...view,
    root,
    engine,
    changeMode: (nextMode: BoardMode) => {
      view.rerender(shell(nextMode));
    },
  };
}

function expectChrome(mode: 'classic' | 'floating', root: HTMLElement): void {
  const board = screen.getByRole('group', { name: 'Board' });
  const presence = screen.getByRole('group', { name: 'Presence and sharing' });
  expect(screen.getByTestId('effective-chrome').textContent).toBe(mode);
  expect(root.getAttribute('data-whiteboard-chrome')).toBe(mode === 'floating' ? 'floating' : null);
  expect(board.hasAttribute('data-floating-sheet')).toBe(mode === 'floating');
  expect(board.getAttribute('data-shape')).toBe(mode === 'floating' ? 'bar' : null);
  expect(presence.hasAttribute('data-floating-sheet')).toBe(mode === 'floating');
}

describe('AppShell chrome by shown board mode', () => {
  it('uses the floating board and presence bars and mounts the floating engine on whiteboard', () => {
    const { root, engine } = renderShell('whiteboard');
    expectChrome('floating', root);
    expect(engine.options.whiteboardChrome).toBe('floating');
    // The floating board bar (its subtitle no longer names the mode).
    expect(screen.getByRole('group', { name: 'Board' }).getAttribute('data-top-bar')).toBe('board');
  });

  it.each(['uiux', 'slides'] as const)(
    'keeps classic board, presence, icons and engine palette in %s mode',
    (mode) => {
      const { root, engine } = renderShell(mode);
      expectChrome('classic', root);
      // A classic mount names no chrome (MountEngineOptions: classic if absent); it is told after.
      expect(engine.options).not.toHaveProperty('whiteboardChrome');
      expect(engine.chromes.at(-1)).toBe('classic');
      expect(screen.getByRole('button', { name: 'Board menu' })).toBeTruthy();
      const icon = screen
        .getByRole('toolbar', { name: 'Tools' })
        .querySelector('[data-icon="select"] path');
      expect(icon?.getAttribute('d')).toBe(ICON_PATHS.select);
      expect(icon?.getAttribute('d')).not.toBe(LIBRARY_ICON_PATHS.select);
    },
  );

  it('updates the effective chrome and mounted engine in both directions as mode changes', () => {
    const { changeMode, root, engine } = renderShell('whiteboard');
    expectChrome('floating', root);
    changeMode('uiux');
    expectChrome('classic', root);
    expect(engine.chromes.at(-1)).toBe('classic');
    changeMode('whiteboard');
    expectChrome('floating', root);
    expect(engine.chromes.at(-1)).toBe('floating');
  });
});
