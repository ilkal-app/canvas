// @vitest-environment jsdom
// ⋯ toggles the floating board menu: a second press closes it, as a press outside would, and
// does not open it again on the click that follows.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeMount } from '../engine/__fixtures__/fake-mounted-engine.js';

import { AppShell } from './app-shell.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('the floating board menu button', () => {
  it('closes on a second press instead of opening again', () => {
    render(
      <AppShell
        platform="mac"
        mountEngine={createFakeMount().mount}
        boardBar={{ homeHref: '/', onNavigateHome: vi.fn(), floatingMenu: {} }}
      />,
    );
    const button = screen.getByRole('button', { name: 'Board menu' });
    const press = (): void => {
      act(() => {
        fireEvent.pointerDown(button);
      });
      act(() => {
        fireEvent.click(button);
      });
    };
    press();
    expect(screen.getByRole('menu', { name: 'Board menu' })).toBeTruthy();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    press();
    expect(screen.queryByRole('menu', { name: 'Board menu' })).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    press();
    expect(screen.getByRole('menu', { name: 'Board menu' })).toBeTruthy();
  });

  it('opens on the next click after a press on ⋯ that ended without a click', () => {
    render(
      <AppShell
        platform="mac"
        mountEngine={createFakeMount().mount}
        boardBar={{ homeHref: '/', onNavigateHome: vi.fn(), floatingMenu: {} }}
      />,
    );
    const button = screen.getByRole('button', { name: 'Board menu' });
    fireEvent.click(button);
    expect(screen.getByRole('menu', { name: 'Board menu' })).toBeTruthy();
    // Pressed on ⋯ and dragged off: the menu closes, and no click follows.
    act(() => {
      fireEvent.pointerDown(button);
    });
    act(() => {
      fireEvent.pointerUp(document.body);
    });
    expect(screen.queryByRole('menu', { name: 'Board menu' })).toBeNull();
    fireEvent.click(button);
    expect(screen.getByRole('menu', { name: 'Board menu' })).toBeTruthy();
  });
});
