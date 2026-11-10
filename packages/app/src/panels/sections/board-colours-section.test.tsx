// @vitest-environment jsdom
// The inspector's Board colours section: every token of the board with its light and
// dark values, each edit one colour token action. In Chrome:
// tooling/scenario/specs/app/color-tokens-board-colours.spec.ts.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BUILTIN_TOKEN_DEFAULTS, type TokenEntry, type TokenTable } from '@canvas/schema';

import type { ShellAction } from '../../state/shell-action.js';
import { rgbaToHex } from '../controls/colour-hex.js';
import { ColourTokensProvider } from '../controls/colour-tokens-context.js';
import type { StylePanelSectionProps } from '../panel-sections.js';

import { stylePanelSection } from './board-colours-section.js';

const BRAND: TokenEntry = {
  id: 'brand1',
  name: 'Brand',
  light: [1, 0, 0, 1],
  dark: [0, 0, 1, 1],
  builtin: false,
  createdBy: null,
  createdAt: 0,
};

const EDITED_TEXT: TokenEntry = {
  id: 'text',
  name: 'text',
  light: [0, 1, 0, 1],
  dark: [0, 0.5, 0, 1],
  builtin: true,
  createdBy: null,
  createdAt: 0,
};

afterEach(cleanup);

/**
 * Renders the section over a token table.
 *
 * @param table - The board's tokens.
 * @returns The dispatch spy.
 */
function renderSection(table: TokenTable) {
  const dispatch = vi.fn<(action: ShellAction) => void>();
  const props = { context: 'none', selection: [], dispatch } as unknown as StylePanelSectionProps;
  render(
    <ColourTokensProvider value={{ table, mode: 'light' }}>
      <stylePanelSection.render {...props} />
    </ColourTokensProvider>,
  );
  return { dispatch };
}

/**
 * Commits a colour the way the browser does.
 *
 * @param input - The colour input.
 * @param value - The hex.
 */
function commit(input: HTMLElement, value: string): void {
  (input as HTMLInputElement).value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('the Board colours section', () => {
  it('registers for nothing selected, collapsed until opened', () => {
    expect(stylePanelSection).toMatchObject({ id: 'board-colours', title: 'Board colours' });
    expect(stylePanelSection.context).toBe('none');
    expect(stylePanelSection.isCollapsedByDefault?.({} as StylePanelSectionProps)).toBe(true);
  });

  it('lists the built-ins, then custom tokens, with their light and dark values', () => {
    renderSection(new Map([['brand1', BRAND]]));
    const names = screen.getAllByRole('group').map((group) => group.getAttribute('aria-label'));
    expect(names).toEqual(['ink', 'text', 'muted', 'surface', 'border', 'accent', 'Brand']);
    const accent = within(screen.getByRole('group', { name: 'accent' }));
    expect(accent.getByLabelText<HTMLInputElement>('Dark').value).toBe(
      rgbaToHex(BUILTIN_TOKEN_DEFAULTS.accent.dark),
    );
    expect(accent.queryByRole('button', { name: 'Reset accent' })).toBeNull();
    expect(accent.queryByLabelText('Name')).toBeNull();
  });

  it('sets one value of a token, sending only that mode', () => {
    const { dispatch } = renderSection(new Map([['brand1', BRAND]]));
    const brand = within(screen.getByRole('group', { name: 'Brand' }));
    commit(brand.getByLabelText('Dark'), '#00ff00');
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'colorToken',
      command: 'setValue',
      id: 'brand1',
      mode: 'dark',
      value: [0, 1, 0, 1],
    });
  });

  it('renames and deletes a custom token, and resets an edited built-in', () => {
    const { dispatch } = renderSection(
      new Map([
        ['brand1', BRAND],
        ['text', EDITED_TEXT],
      ]),
    );
    const brand = within(screen.getByRole('group', { name: 'Brand' }));
    const name = brand.getByLabelText('Name');
    fireEvent.change(name, { target: { value: 'Logo' } });
    fireEvent.blur(name);
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'colorToken',
      command: 'rename',
      id: 'brand1',
      name: 'Logo',
    });
    fireEvent.click(brand.getByRole('button', { name: 'Delete Brand' }));
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'colorToken',
      command: 'delete',
      id: 'brand1',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset text' }));
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'colorToken', command: 'reset', id: 'text' });
  });

  it('adds a custom token under the first free name', () => {
    const { dispatch } = renderSection(new Map([['brand1', { ...BRAND, name: 'Colour 1' }]]));
    fireEvent.click(screen.getByRole('button', { name: 'Add colour' }));
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'colorToken',
      command: 'set',
      name: 'Colour 2',
      light: [...BUILTIN_TOKEN_DEFAULTS.accent.light],
      dark: [...BUILTIN_TOKEN_DEFAULTS.accent.dark],
    });
  });
});
