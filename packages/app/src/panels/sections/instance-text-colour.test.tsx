// @vitest-environment jsdom
// The instance section's "Text colour": a row for a child that shows text recolours it
// with `textStyle.color`, keeping any other style fields the record holds, and its own Reset
// clears the colour alone.
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
 * Renders the section for the card's instance, which a person may edit.
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
 * A child's row.
 *
 * @param name - The row's name.
 * @returns The row.
 */
function row(name: string): HTMLElement {
  return screen.getByRole('group', { name });
}

afterEach(cleanup);

describe('the instance section’s text colour', () => {
  it('recolours a text child’s text, showing the main’s colour until then', () => {
    const { store } = createComponentBoard();
    const { dispatch } = renderSection(store);
    const title = row('Text “Title”');
    const colour = within(title).getByLabelText<HTMLInputElement>('Text colour');
    expect(colour.value).toBe('#1a1a1f');
    expect(within(title).queryByRole('button', { name: 'Reset text colour' })).toBeNull();
    fireEvent.change(colour, { target: { value: '#ff0000' } });
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'component',
      command: 'setOverride',
      id: 'inst',
      path: 'title',
      override: { textStyle: { color: [1, 0, 0, 1] } },
    });
  });

  it('recolours a note’s text beside its background colour', () => {
    const { store } = createComponentBoard();
    const { dispatch } = renderSection(store);
    const note = row('Note “Notes”');
    expect(within(note).getByLabelText('Colour')).toBeDefined();
    fireEvent.change(within(note).getByLabelText('Text colour'), {
      target: { value: '#00ff00' },
    });
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'component',
      command: 'setOverride',
      id: 'inst',
      path: 'note',
      override: { textStyle: { color: [0, 1, 0, 1] } },
    });
  });

  it('keeps the record’s other style fields when it recolours', () => {
    const { store } = createComponentBoard();
    mustRun(store, 'setInstanceOverride', {
      id: 'inst',
      path: 'title',
      override: { textStyle: { color: [0, 0, 1, 1], fontSize: 40 } },
    });
    const { dispatch } = renderSection(store);
    const colour = within(row('Text “Title”')).getByLabelText<HTMLInputElement>('Text colour');
    expect(colour.value).toBe('#0000ff');
    fireEvent.change(colour, { target: { value: '#ff0000' } });
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'component',
      command: 'setOverride',
      id: 'inst',
      path: 'title',
      override: { textStyle: { color: [1, 0, 0, 1], fontSize: 40 } },
    });
  });

  it('resets the text colour alone: the whole style when it holds only the colour', () => {
    const { store } = createComponentBoard();
    mustRun(store, 'setInstanceOverride', {
      id: 'inst',
      path: 'title',
      override: { text: 'Later', textStyle: { color: [0, 0, 1, 1] } },
    });
    const { dispatch } = renderSection(store);
    fireEvent.click(within(row('Text “Title”')).getByRole('button', { name: 'Reset text colour' }));
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'component',
      command: 'resetOverrides',
      id: 'inst',
      path: 'title',
      fields: ['textStyle'],
    });
  });

  it('resets the text colour alone: the other style fields stay', () => {
    const { store } = createComponentBoard();
    mustRun(store, 'setInstanceOverride', {
      id: 'inst',
      path: 'title',
      override: { textStyle: { color: [0, 0, 1, 1], weight: 700 } },
    });
    const { dispatch } = renderSection(store);
    fireEvent.click(within(row('Text “Title”')).getByRole('button', { name: 'Reset text colour' }));
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'component',
      command: 'setOverride',
      id: 'inst',
      path: 'title',
      override: { textStyle: { weight: 700 } },
    });
  });

  it('offers no text colour where the child shows no text', () => {
    const { store } = createComponentBoard();
    renderSection(store);
    expect(within(row('Image')).queryByLabelText('Text colour')).toBeNull();
    for (const rectangle of screen.getAllByRole('group', { name: 'Rectangle' })) {
      expect(within(rectangle).queryByLabelText('Text colour')).toBeNull();
    }
  });
});
