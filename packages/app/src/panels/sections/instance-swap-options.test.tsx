// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { mustRun } from '../../engine/__fixtures__/component-board.js';

import { renderSwapSection, swapBoard } from './__fixtures__/swap-section.js';

afterEach(cleanup);

function optionsGroup(): HTMLElement {
  return screen.getByRole('group', { name: 'Swap options' });
}

describe('slot swap options in the main inspector', () => {
  it('shows the group only for a slot inside a main', () => {
    const store = swapBoard();
    renderSwapSection(store, 'inst');
    expect(screen.queryByRole('group', { name: 'Swap options' })).toBeNull();
    cleanup();
    renderSwapSection(store, 'badge-in-card');
    expect(within(optionsGroup()).getByRole('checkbox', { name: 'Any main' })).toBeDefined();
    expect(within(optionsGroup()).getByRole('checkbox', { name: 'Check' })).toBeDefined();
  });

  it('checks live mains and dispatches the selected ids, then Any main clears the list', () => {
    const store = swapBoard();
    const { dispatch } = renderSwapSection(store, 'badge-in-card');
    fireEvent.click(within(optionsGroup()).getByRole('checkbox', { name: 'Check' }));
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'component',
      command: 'setSwapOptions',
      id: 'badge-in-card',
      options: ['check'],
    });
    cleanup();
    mustRun(store, 'setSwapOptions', { id: 'badge-in-card', options: ['check'] });
    const next = renderSwapSection(store, 'badge-in-card');
    fireEvent.click(within(optionsGroup()).getByRole('checkbox', { name: 'Any main' }));
    expect(next.dispatch).toHaveBeenLastCalledWith({
      type: 'component',
      command: 'setSwapOptions',
      id: 'badge-in-card',
      options: null,
    });
  });

  it('disables the group for read-only and locked slots', () => {
    for (const options of [{ canEdit: false }, { isLocked: true }]) {
      const store = swapBoard();
      renderSwapSection(store, 'badge-in-card', options);
      const check = within(optionsGroup()).getByRole('checkbox', { name: 'Check' });
      expect(check.hasAttribute('disabled') || check.closest('fieldset')?.disabled).toBe(true);
      cleanup();
    }
  });
});
