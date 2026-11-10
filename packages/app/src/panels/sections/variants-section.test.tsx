// @vitest-environment jsdom
// The inspector's Variants section for a main over a real board: "Add variants", each
// axis edit one `setVariantAxes` with the whole list, a refused name reverting, and "Edit preset"
// editing one value's preset while previewing it.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { YjsDocumentStore } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import { createComponentBoard, mustRun } from '../../engine/__fixtures__/component-board.js';
import { createDefaultShortcutRegistry } from '../../keymap/default-keymap.js';
import type { ShellAction } from '../../state/shell-action.js';
import type { StylePanelSectionProps } from '../panel-sections.js';

import { stylePanelSection } from './variants-section.js';

const AXES = [{ name: 'state', values: ['rest', 'hover'] }];

/**
 * Renders the section for the card's main.
 *
 * @param store - The board.
 * @returns The dispatch spy and the render's unmount.
 * @throws {Error} When the main is missing.
 */
function renderSection(store: YjsDocumentStore) {
  const dispatch = vi.fn<(action: ShellAction) => void>();
  const main = store.get('card' as ObjectId);
  if (main === undefined) throw new Error('no main');
  const props: StylePanelSectionProps = {
    context: 'component',
    selection: [main],
    board: store,
    definitions: store,
    defaults: undefined,
    isLocked: false,
    canEdit: true,
    shortcuts: createDefaultShortcutRegistry('other'),
    dispatch,
    applyStyle: vi.fn(),
  };
  const { unmount } = render(<stylePanelSection.render {...props} />);
  return { dispatch, unmount };
}

/**
 * The card with a `state` axis whose `hover` preset fills the body.
 *
 * @returns The store.
 */
function variantBoard(): YjsDocumentStore {
  const { store } = createComponentBoard();
  mustRun(store, 'setVariantAxes', { componentId: 'card', axes: AXES });
  mustRun(store, 'setVariantPreset', {
    componentId: 'card',
    axis: 'state',
    value: 'hover',
    path: 'body',
    override: { fill: [0, 0, 1, 1] },
  });
  return store;
}

/**
 * Types a name into a field and commits it with Enter.
 *
 * @param field - The field.
 * @param value - The name.
 */
function commit(field: HTMLElement, value: string): void {
  fireEvent.change(field, { target: { value } });
  fireEvent.keyDown(field, { key: 'Enter' });
}

/**
 * The card body's row: the last "Rectangle", after the nested badge's.
 *
 * @returns The row.
 * @throws {Error} When there is none.
 */
function bodyRow(): HTMLElement {
  const row = screen.getAllByRole('group', { name: 'Rectangle' }).at(-1);
  if (row === undefined) throw new Error('no body row');
  return row;
}

afterEach(cleanup);

describe('the Variants section', () => {
  it('registers for mains after the component section', () => {
    expect(stylePanelSection).toMatchObject({
      id: 'variants',
      context: 'component',
      isSelectionOnly: true,
    });
  });

  it('adds variants to a main without axes', () => {
    const { store } = createComponentBoard();
    const { dispatch } = renderSection(store);
    fireEvent.click(screen.getByRole('button', { name: 'Add variants' }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'component',
      command: 'setVariantAxes',
      id: 'card',
      axes: [{ name: 'state', values: ['default', 'variant 2'] }],
    });
  });

  it('edits the axes, each one whole list, renames carrying presets', () => {
    const { dispatch } = renderSection(variantBoard());
    const axis = screen.getByRole('group', { name: 'state' });
    const setAxes = (axes: unknown, renames?: unknown) => ({
      type: 'component',
      command: 'setVariantAxes',
      id: 'card',
      axes,
      ...(renames === undefined ? {} : { renames }),
    });
    commit(within(axis).getByRole('textbox', { name: 'Name' }), 'mode');
    expect(dispatch).toHaveBeenLastCalledWith(
      setAxes([{ name: 'mode', values: ['rest', 'hover'] }], {
        axes: [{ from: 'state', to: 'mode' }],
      }),
    );
    commit(within(axis).getAllByRole('textbox', { name: 'Value' }).at(1) ?? axis, 'over');
    expect(dispatch).toHaveBeenLastCalledWith(
      setAxes([{ name: 'state', values: ['rest', 'over'] }], {
        values: [{ axis: 'state', from: 'hover', to: 'over' }],
      }),
    );
    fireEvent.click(within(axis).getByRole('button', { name: 'Make default' }));
    expect(dispatch).toHaveBeenLastCalledWith(
      setAxes([{ name: 'state', values: ['hover', 'rest'] }]),
    );
    fireEvent.click(within(axis).getAllByRole('button', { name: 'Remove value' }).at(0) ?? axis);
    expect(dispatch).toHaveBeenLastCalledWith(setAxes([{ name: 'state', values: ['hover'] }]));
    fireEvent.click(within(axis).getByRole('button', { name: 'Add value' }));
    expect(dispatch).toHaveBeenLastCalledWith(
      setAxes([{ name: 'state', values: ['rest', 'hover', 'value 3'] }]),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add axis' }));
    expect(dispatch).toHaveBeenLastCalledWith(
      setAxes([...AXES, { name: 'axis 2', values: ['default'] }]),
    );
    // Removing the last axis removes variants.
    fireEvent.click(within(axis).getByRole('button', { name: 'Remove axis' }));
    expect(dispatch).toHaveBeenLastCalledWith(setAxes(null));
  });

  it('reverts a blank, duplicate or `=` name and writes nothing', () => {
    const { dispatch } = renderSection(variantBoard());
    const axis = screen.getByRole('group', { name: 'state' });
    const value = within(axis).getAllByRole<HTMLInputElement>('textbox', { name: 'Value' }).at(1);
    if (value === undefined) throw new Error('no second value');
    for (const name of ['', 'rest', 'a=b']) {
      commit(value, name);
      expect(value.value).toBe('hover');
    }
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('keeps an axis’s last value', () => {
    const { store } = createComponentBoard();
    mustRun(store, 'setVariantAxes', {
      componentId: 'card',
      axes: [{ name: 'size', values: ['s'] }],
    });
    renderSection(store);
    const remove = screen.getByRole<HTMLButtonElement>('button', { name: 'Remove value' });
    expect(remove.disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Make default' })).toBeNull();
  });

  it('edits a preset through the rows while previewing it, and clears the preview', () => {
    const { dispatch, unmount } = renderSection(variantBoard());
    const preset = screen.getByRole('combobox', { name: 'Edit preset' });
    expect(screen.queryAllByRole('group', { name: 'Rectangle' })).toEqual([]);
    fireEvent.change(preset, { target: { value: 'state=hover' } });
    const hover = { id: 'card', axis: 'state', value: 'hover' };
    expect(dispatch).toHaveBeenCalledWith({
      type: 'component',
      command: 'previewPreset',
      ...hover,
    });
    const body = bodyRow();
    fireEvent.change(within(body).getByLabelText('Fill'), { target: { value: '#00ff00' } });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'component',
      command: 'setPreset',
      ...hover,
      path: 'body',
      override: { fill: [0, 1, 0, 1] },
    });
    fireEvent.click(within(body).getByRole('button', { name: 'Reset fill' }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'component',
      command: 'resetPreset',
      ...hover,
      path: 'body',
      fields: ['fill'],
    });
    fireEvent.change(preset, { target: { value: '' } });
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'component',
      command: 'previewPreset',
      id: 'card',
    });
    fireEvent.change(preset, { target: { value: 'state=hover' } });
    dispatch.mockClear();
    unmount();
    expect(dispatch).toHaveBeenCalledWith({
      type: 'component',
      command: 'previewPreset',
      id: 'card',
    });
  });

  it('shows nothing without a main selected', () => {
    const { store } = createComponentBoard();
    const instance = store.get('inst' as ObjectId);
    if (instance === undefined) throw new Error('no instance');
    const props: StylePanelSectionProps = {
      context: 'component',
      selection: [instance],
      board: store,
      defaults: undefined,
      isLocked: false,
      shortcuts: createDefaultShortcutRegistry('other'),
      dispatch: vi.fn(),
      applyStyle: vi.fn(),
    };
    const { container } = render(<stylePanelSection.render {...props} />);
    expect(container.childElementCount).toBe(0);
  });
});
