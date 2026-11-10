// @vitest-environment jsdom
// The floating board bar's Home leaves a modified or non-primary click to the browser.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeMount } from '../engine/__fixtures__/fake-mounted-engine.js';

import { AppShell } from './app-shell.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('floating board bar Home', () => {
  it.each([
    { kind: 'alt', init: { altKey: true } },
    { kind: 'meta', init: { metaKey: true } },
    { kind: 'ctrl', init: { ctrlKey: true } },
    { kind: 'shift', init: { shiftKey: true } },
    { kind: 'middle button', init: { button: 1 } },
  ])('follows the link itself on a $kind click', ({ init }) => {
    const onNavigateHome = vi.fn();
    render(
      <AppShell
        platform="mac"
        mountEngine={createFakeMount().mount}
        boardBar={{ homeHref: '/', onNavigateHome }}
      />,
    );
    const home = screen.getByRole('link', { name: 'All boards' });
    const isNotPrevented = fireEvent.click(home, init);
    expect(onNavigateHome).not.toHaveBeenCalled();
    expect(isNotPrevented).toBe(true);
  });
});
