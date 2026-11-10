// @vitest-environment jsdom
// The colour control's board colour tokens: the Tokens list, a token chosen, a token's
// value shown in the mode given, and Detach colour.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BUILTIN_TOKEN_DEFAULTS, type TokenEntry, type TokenTable } from '@canvas/schema';

import { ColourControl, type ColourControlProps } from './colour-control.js';
import { rgbaToHex } from './colour-hex.js';
import { ColourTokensProvider } from './colour-tokens-context.js';

const BRAND: TokenEntry = {
  id: 'brand1',
  name: 'Brand',
  light: [1, 0, 0, 1],
  dark: [0, 0, 1, 0.5],
  builtin: false,
  createdBy: null,
  createdAt: 0,
};

const TABLE: TokenTable = new Map([['brand1', BRAND]]);

afterEach(cleanup);

/**
 * Renders a colour control under a token table and a mode.
 *
 * @param props - The control's props.
 * @param mode - The mode tokens are shown in.
 * @returns What was rendered.
 */
function renderControl(props: ColourControlProps, mode: 'light' | 'dark' = 'light') {
  const element: ReactElement = (
    <ColourTokensProvider value={{ table: TABLE, mode }}>
      <ColourControl {...props} />
    </ColourTokensProvider>
  );
  return render(element);
}

describe('ColourControl with tokens', () => {
  it('shows no Tokens button without onToken, and the list only once opened', () => {
    renderControl({ label: 'Stop 1', value: [0, 0, 0, 1], onChange: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Stop 1 tokens' })).toBeNull();
    cleanup();
    renderControl({ label: 'Fill', value: [0, 0, 0, 1], onChange: vi.fn(), onToken: vi.fn() });
    const opener = screen.getByRole('button', { name: 'Fill tokens' });
    expect(opener.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('group', { name: 'Fill tokens' })).toBeNull();
    fireEvent.click(opener);
    expect(opener.getAttribute('aria-expanded')).toBe('true');
    const list = screen.getByRole('group', { name: 'Fill tokens' });
    expect(opener.getAttribute('aria-controls')).toBe(list.id);
    const names = [...list.querySelectorAll('button')].map((button) => button.textContent);
    expect(names).toEqual(['ink', 'text', 'muted', 'surface', 'border', 'accent', 'Brand']);
  });

  it('chooses a token as a reference and closes the list', () => {
    const onToken = vi.fn();
    const onChange = vi.fn();
    renderControl({ label: 'Fill', value: [0, 0, 0, 1], onChange, onToken });
    fireEvent.click(screen.getByRole('button', { name: 'Fill tokens' }));
    fireEvent.click(screen.getByRole('button', { name: 'Brand' }));
    expect(onToken).toHaveBeenCalledWith({ token: 'brand1' });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('group', { name: 'Fill tokens' })).toBeNull();
  });

  it('closes the list on Escape and gives the keyboard back to the button', () => {
    renderControl({ label: 'Fill', value: [0, 0, 0, 1], onChange: vi.fn(), onToken: vi.fn() });
    const opener = screen.getByRole('button', { name: 'Fill tokens' });
    fireEvent.click(opener);
    fireEvent.keyDown(screen.getByRole('button', { name: 'accent' }), { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Fill tokens' })).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('shows swatches in the mode given and presses the token the field names', () => {
    renderControl(
      { label: 'Fill', value: { token: 'brand1' }, onChange: vi.fn(), onToken: vi.fn() },
      'dark',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fill tokens' }));
    const brand = screen.getByRole('button', { name: 'Brand' });
    expect(brand.getAttribute('aria-pressed')).toBe('true');
    const swatch = brand.querySelector('span');
    // The dark value, its alpha kept over the checkerboard (it was drawn opaque).
    expect(swatch?.style.background).toContain('rgb(0 0 255 / 0.5)');
    const accent = screen.getByRole('button', { name: 'accent' });
    expect(accent.getAttribute('aria-pressed')).toBe('false');
  });

  it('shows a token by name with its value in the mode, and detaches to that value', () => {
    const onChange = vi.fn();
    renderControl({ label: 'Fill', value: { token: 'brand1' }, onChange }, 'dark');
    const input = screen.getByLabelText<HTMLInputElement>('Fill');
    expect(input.value).toBe(rgbaToHex(BRAND.dark));
    expect(input.parentElement?.dataset.state).toBe('token');
    expect(screen.getByText('Brand')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Detach colour' }));
    expect(onChange).toHaveBeenCalledWith([0, 0, 1, 0.5]);
  });

  it('shows a built-in at the board defaults, and a missing token as unknown in ink', () => {
    const onChange = vi.fn();
    renderControl({ label: 'Stroke', value: { token: 'muted' }, onChange }, 'light');
    expect(screen.getByLabelText<HTMLInputElement>('Stroke').value).toBe(
      rgbaToHex(BUILTIN_TOKEN_DEFAULTS.muted.light),
    );
    cleanup();
    renderControl({ label: 'Stroke', value: { token: 'gone' }, onChange }, 'dark');
    expect(screen.getByText('Unknown colour')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Detach colour' }));
    expect(onChange).toHaveBeenCalledWith(BUILTIN_TOKEN_DEFAULTS.ink.dark);
  });
});
