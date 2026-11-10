// @vitest-environment jsdom
// The phone floating board bar moves Search into its menu.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';
import { createFakeMount } from '../engine/__fixtures__/fake-mounted-engine.js';

import { fakeViewport } from './__fixtures__/fake-media.js';
import { AppShell } from './app-shell.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

it('renders the compact floating board bar with Search in its menu only below 768 px', () => {
  const viewport = fakeViewport(390);
  vi.stubGlobal('matchMedia', (query: string) =>
    query.startsWith('(width <')
      ? viewport.matchMedia(query)
      : {
          matches: false,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        },
  );
  render(
    <AppShell
      platform="mac"
      mountEngine={createFakeMount().mount}
      connection={new FakeBoardConnection('demo')}
      boardBar={{ homeHref: '/', onNavigateHome: vi.fn() }}
    />,
  );
  const mobile = screen.getByRole('group', { name: 'Board' });
  expect(mobile.dataset.shape).toBe('bar');
  expect(mobile.hasAttribute('data-compact')).toBe(true);
  expect(within(mobile).getByRole('link', { name: 'All boards' })).toBeTruthy();
  expect(within(mobile).getByRole('heading', { level: 1 })).toBeTruthy();
  expect(within(mobile).queryByRole('button', { name: 'Search board' })).toBeNull();
  act(() => {
    viewport.resize(768);
  });
  const desktop = screen.getByRole('group', { name: 'Board' });
  expect(desktop.hasAttribute('data-compact')).toBe(false);
  expect(within(desktop).getByRole('button', { name: 'Search board' })).toBeTruthy();
});
