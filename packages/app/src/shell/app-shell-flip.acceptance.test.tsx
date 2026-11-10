// @vitest-environment jsdom
// A board's mode fixes its chrome, and no shell offers a mode switcher.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardMode } from '@canvas/schema';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';
import { createFakeMount } from '../engine/__fixtures__/fake-mounted-engine.js';

import { fakeViewport } from './__fixtures__/fake-media.js';
import { AppShell } from './app-shell.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function renderShell(mode: BoardMode) {
  const { mount, engines } = createFakeMount();
  const view = render(
    <AppShell
      platform="mac"
      mountEngine={mount}
      connection={new FakeBoardConnection('demo')}
      boardName="Plans"
      mode={mode}
    />,
  );
  const root = view.container.firstElementChild;
  if (!(root instanceof HTMLElement)) throw new Error('AppShell rendered no root');
  const engine = engines[0];
  if (engine === undefined) throw new Error('AppShell mounted no engine');
  return { root, engine };
}

describe('AppShell after the whiteboard chrome flip', () => {
  it('defaults a whiteboard to the floating board bar and engine palette', () => {
    const { root, engine } = renderShell('whiteboard');
    const board = screen.getByRole('group', { name: 'Board' });
    expect(root.getAttribute('data-whiteboard-chrome')).toBe('floating');
    expect(board.getAttribute('data-floating-sheet')).toBe('');
    expect(board.getAttribute('data-shape')).toBe('bar');
    expect(engine.options.whiteboardChrome).toBe('floating');
    expect(screen.getByRole('toolbar', { name: 'Tools' }).hasAttribute('data-floating-dock')).toBe(
      true,
    );
  });

  it.each(['uiux', 'slides'] as const)('keeps the classic board bar and engine in %s', (mode) => {
    const { root, engine } = renderShell(mode);
    const board = screen.getByRole('group', { name: 'Board' });
    expect(root.hasAttribute('data-whiteboard-chrome')).toBe(false);
    expect(board.hasAttribute('data-floating-sheet')).toBe(false);
    expect(within(board).getByText('Plans')).toBeTruthy();
    expect(engine.chromes.at(-1)).toBe('classic');
  });

  it.each(['whiteboard', 'uiux', 'slides'] as const)(
    'has no desktop mode switcher in %s',
    (mode) => {
      renderShell(mode);
      expect(screen.queryByRole('radiogroup', { name: 'Board mode' })).toBeNull();
    },
  );

  it.each(['whiteboard', 'uiux', 'slides'] as const)(
    'has no compact Board mode button in %s',
    (mode) => {
      const viewport = fakeViewport(390);
      vi.stubGlobal('matchMedia', (query: string) =>
        query.startsWith('(width <')
          ? viewport.matchMedia(query)
          : viewport.matchMedia('(width < 0px)'),
      );
      renderShell(mode);
      const tools = screen.getByRole('toolbar', { name: 'Tools' });
      expect(within(tools).queryByRole('button', { name: /^Board mode/ })).toBeNull();
    },
  );
});
