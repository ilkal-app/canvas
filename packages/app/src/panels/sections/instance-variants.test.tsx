// @vitest-environment jsdom
// The instance section with variants over a real board: a picker per axis, rows showing
// what the chosen presets set ("From variant", no Reset), and unhiding a preset-hidden child.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { YjsDocumentStore } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import { createComponentBoard, mustRun } from '../../engine/__fixtures__/component-board.js';
import { createDefaultShortcutRegistry } from '../../keymap/default-keymap.js';
import type { ShellAction } from '../../state/shell-action.js';
import type { StylePanelSectionProps } from '../panel-sections.js';

import { stylePanelSection } from './instance-section.js';

/**
 * Renders the section for the card's instance.
 *
 * @param store - The board.
 * @returns The dispatch spy.
 * @throws {Error} When the instance is missing.
 */
function renderSection(store: YjsDocumentStore) {
  const dispatch = vi.fn<(action: ShellAction) => void>();
  const instance = store.get('inst' as ObjectId);
  if (instance === undefined) throw new Error('no instance');
  const props: StylePanelSectionProps = {
    context: 'instance',
    selection: [instance],
    board: store,
    definitions: store,
    defaults: undefined,
    isLocked: false,
    canEdit: true,
    shortcuts: createDefaultShortcutRegistry('other'),
    dispatch,
    applyStyle: vi.fn(),
  };
  render(<stylePanelSection.render {...props} />);
  return { dispatch };
}

/**
 * The card with a `state` axis whose `hover` preset fills the body, retitles and hides the note,
 * and the instance on `hover`.
 *
 * @returns The store.
 */
function hoveredBoard(): YjsDocumentStore {
  const { store } = createComponentBoard();
  mustRun(store, 'setVariantAxes', {
    componentId: 'card',
    axes: [{ name: 'state', values: ['rest', 'hover'] }],
  });
  const hover = { componentId: 'card', axis: 'state', value: 'hover' };
  for (const [path, override] of [
    ['body', { fill: [0, 0, 1, 1] }],
    ['title', { text: 'Hover', textStyle: { color: [1, 0, 0, 1] } }],
    ['note', { isHidden: true }],
  ] as const) {
    mustRun(store, 'setVariantPreset', { ...hover, path, override });
  }
  mustRun(store, 'setInstanceVariant', { id: 'inst', variant: { state: 'hover' } });
  return store;
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

describe('the instance section with variants', () => {
  it('shows a picker per axis and switches the instance', () => {
    const { dispatch } = renderSection(hoveredBoard());
    const picker = screen.getByRole<HTMLSelectElement>('combobox', { name: 'state' });
    expect(picker.value).toBe('hover');
    fireEvent.change(picker, { target: { value: 'rest' } });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'component',
      command: 'setVariant',
      id: 'inst',
      variant: { state: 'rest' },
    });
  });

  it('shows what the chosen presets set, "From variant", with no Reset', () => {
    renderSection(hoveredBoard());
    const body = bodyRow();
    expect(within(body).getByLabelText<HTMLInputElement>('Fill').value).toBe('#0000ff');
    expect(within(body).getByText('From variant')).toBeDefined();
    expect(within(body).queryByRole('button', { name: 'Reset fill' })).toBeNull();
    const title = screen.getByRole('group', { name: 'Text “Title”' });
    expect(within(title).getByRole<HTMLInputElement>('textbox', { name: 'Text' }).value).toBe(
      'Hover',
    );
    expect(within(title).getAllByText('From variant')).toHaveLength(2);
  });

  it('unhides a preset-hidden child with an own record, and hides with one', () => {
    const { dispatch } = renderSection(hoveredBoard());
    const note = screen.getByRole('group', { name: /^Note/ });
    expect(within(note).getByText('From variant')).toBeDefined();
    fireEvent.click(within(note).getByRole('button', { name: 'Hidden' }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'component',
      command: 'setOverride',
      id: 'inst',
      path: 'note',
      override: { isHidden: false },
    });
  });

  it('shows the default for a choice the main no longer lists, and no pickers without axes', () => {
    const store = hoveredBoard();
    mustRun(store, 'setVariantAxes', {
      componentId: 'card',
      axes: [{ name: 'state', values: ['rest'] }],
    });
    renderSection(store);
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'state' }).value).toBe('rest');
    cleanup();
    renderSection(createComponentBoard().store);
    expect(screen.queryByRole('combobox', { name: 'state' })).toBeNull();
  });
});
