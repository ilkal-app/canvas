// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { THEMES } from './theme-tokens.js';
import { TokenSheet } from './token-sheet.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('TokenSheet', () => {
  it('shows every surface, line and colour of the Figma canvas collection by name', () => {
    render(<TokenSheet initialThemePreference="dark" />);
    for (const name of [
      'ground/mat',
      'ground/grid',
      'surface/sheet',
      'surface/raised',
      'surface/pressed',
      'line/hairline',
      'line/strong',
      'line/control',
      'hand/you',
      'hand/agent',
      'mark/red-pencil',
      'mark/live',
      'peer/mira',
      'peer/jonas',
    ]) {
      expect(screen.getByText(name), name).toBeInstanceOf(HTMLElement);
    }
  });

  it('shows every text style', () => {
    render(<TokenSheet initialThemePreference="dark" />);
    for (const name of [
      'UI/Title',
      'UI/Body',
      'UI/Label',
      'UI/Section',
      'UI/Caption',
      'Mono/Value',
      'Mono/Key',
    ]) {
      expect(screen.getByText(name), name).toBeInstanceOf(HTMLElement);
    }
  });

  it('applies its theme to its own root and switches it from its theme button', () => {
    render(<TokenSheet initialThemePreference="dark" />);
    const root = screen.getByRole('main');
    expect(root.style.getPropertyValue('--color-ground-mat')).toBe(
      THEMES.dark['--color-ground-mat'],
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Graphite tokens');
    fireEvent.click(screen.getByRole('button', { name: 'Theme: Graphite' }));
    expect(root.dataset.theme).toBe('light');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Vellum tokens');
  });

  it('shows faint ink only on a disabled control', () => {
    render(<TokenSheet initialThemePreference="dark" />);
    const disabled = screen.getByRole('button', { name: 'Present — not available yet' });
    expect((disabled as HTMLButtonElement).disabled).toBe(true);
  });
});
