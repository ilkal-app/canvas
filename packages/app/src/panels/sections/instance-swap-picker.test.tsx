// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { mustRun } from '../../engine/__fixtures__/component-board.js';
import { LOCAL_USER_ORIGIN } from '../../engine/demo-document.js';

import { renderSwapSection, swapBoard } from './__fixtures__/swap-section.js';

afterEach(cleanup);

function picker(): HTMLSelectElement {
  return within(screen.getByRole('group', { name: /Instance of/ })).getByRole('combobox', {
    name: 'Main',
  });
}

function choices(): string[] {
  return Array.from(picker().options, (option) => option.textContent);
}

describe('the nested instance swap picker', () => {
  it('shows every live expandable main and always includes the stored main', () => {
    const store = swapBoard();
    renderSwapSection(store);
    expect(picker().value).toBe('badge');
    expect(choices()).toEqual(['Badge', 'Check']);
  });

  it('honours slot options and omits retired or missing mains', () => {
    const store = swapBoard();
    const slot = store.get('badge-in-card' as ObjectId);
    if (slot?.type !== 'instance') throw new Error('missing slot');
    store.transact(LOCAL_USER_ORIGIN, (transaction) => {
      transaction.patchObject(slot.id, { swapOptions: ['check', 'gone'] as ObjectId[] });
    });
    renderSwapSection(store);
    expect(choices()).toEqual(['Badge', 'Check']);
    cleanup();
    const check = store.get('check' as ObjectId);
    if (check?.type !== 'component') throw new Error('missing check');
    store.transact(LOCAL_USER_ORIGIN, (transaction) => {
      transaction.patchObject(check.id, { retired: true });
    });
    renderSwapSection(store);
    expect(choices()).toEqual(['Badge']);
  });

  it('dispatches a mainId override and resets only mainId when the stored main is chosen', () => {
    const store = swapBoard();
    const { dispatch } = renderSwapSection(store);
    fireEvent.change(picker(), { target: { value: 'check' } });
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'component',
      command: 'setOverride',
      id: 'inst',
      path: 'badge-in-card',
      override: { mainId: 'check' },
    });
    cleanup();
    mustRun(store, 'setInstanceOverride', {
      id: 'inst',
      path: 'badge-in-card',
      override: { mainId: 'check' },
    });
    const swapped = renderSwapSection(store);
    expect(picker().value).toBe('check');
    const reset = within(screen.getByRole('group', { name: 'Instance of Check' })).getByRole(
      'button',
      { name: 'Reset main' },
    );
    fireEvent.click(reset);
    expect(swapped.dispatch).toHaveBeenLastCalledWith({
      type: 'component',
      command: 'resetOverrides',
      id: 'inst',
      path: 'badge-in-card',
      fields: ['mainId'],
    });
    fireEvent.change(picker(), { target: { value: 'badge' } });
    expect(swapped.dispatch).toHaveBeenLastCalledWith({
      type: 'component',
      command: 'resetOverrides',
      id: 'inst',
      path: 'badge-in-card',
      fields: ['mainId'],
    });
  });

  it('shows Reset main only while swapped and disables editing for viewers and locked instances', () => {
    for (const options of [{ canEdit: false }, { isLocked: true }]) {
      const store = swapBoard();
      renderSwapSection(store, 'inst', options);
      expect(picker().disabled || picker().closest('fieldset')?.disabled).toBe(true);
      expect(screen.queryByRole('button', { name: 'Reset main' })).toBeNull();
      cleanup();
      mustRun(store, 'setInstanceOverride', {
        id: 'inst',
        path: 'badge-in-card',
        override: { mainId: 'check' },
      });
      renderSwapSection(store, 'inst', options);
      const reset = screen.getByRole('button', { name: 'Reset main' });
      expect(reset.hasAttribute('disabled') || reset.closest('fieldset')?.disabled).toBe(true);
      cleanup();
    }
  });

  it('stores the stored main as the own choice while a variant preset swaps the slot', () => {
    const store = swapBoard();
    mustRun(store, 'setVariantAxes', {
      componentId: 'card',
      axes: [{ name: 'state', values: ['rest', 'hover'] }],
    });
    mustRun(store, 'setVariantPreset', {
      componentId: 'card',
      axis: 'state',
      value: 'hover',
      path: 'badge-in-card',
      override: { mainId: 'check' },
    });
    mustRun(store, 'setInstanceVariant', { id: 'inst', variant: { state: 'hover' } });
    const { dispatch } = renderSwapSection(store);
    const row = screen.getByRole('group', { name: 'Instance of Check' });
    expect(picker().value).toBe('check');
    expect(within(row).getAllByText('From variant').length).toBeGreaterThan(0);
    fireEvent.change(picker(), { target: { value: 'badge' } });
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'component',
      command: 'setOverride',
      id: 'inst',
      path: 'badge-in-card',
      override: { mainId: 'badge' },
    });
    // With that own choice stored, the preset's main is what clearing goes back to.
    cleanup();
    mustRun(store, 'setInstanceOverride', {
      id: 'inst',
      path: 'badge-in-card',
      override: { mainId: 'badge' },
    });
    const own = renderSwapSection(store);
    expect(picker().value).toBe('badge');
    fireEvent.change(picker(), { target: { value: 'check' } });
    expect(own.dispatch).toHaveBeenLastCalledWith({
      type: 'component',
      command: 'resetOverrides',
      id: 'inst',
      path: 'badge-in-card',
      fields: ['mainId'],
    });
  });
});
