// @vitest-environment jsdom
// The inspector's component section for a main (rulings 4 and 8): its name, renamed on
// Enter, how many instances it has across the board, and Place instance.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { YjsDocumentStore } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import { createComponentBoard, mustRun } from '../../engine/__fixtures__/component-board.js';
import { createDefaultShortcutRegistry } from '../../keymap/default-keymap.js';
import type { ShellAction } from '../../state/shell-action.js';
import type { StylePanelSectionProps } from '../panel-sections.js';

import { stylePanelSection } from './component-section.js';

/**
 * Renders the section for a main.
 *
 * @param store - The board.
 * @param mainId - The main.
 * @param canEdit - Whether the person may edit.
 * @returns The dispatch spy.
 * @throws {Error} When the main is missing.
 */
function renderSection(store: YjsDocumentStore, mainId = 'card', canEdit = true) {
  const dispatch = vi.fn<(action: ShellAction) => void>();
  const main = store.get(mainId as ObjectId);
  if (main === undefined) throw new Error(`no ${mainId}`);
  const props: StylePanelSectionProps = {
    context: 'component',
    selection: [main],
    board: store,
    definitions: store,
    defaults: undefined,
    isLocked: false,
    canEdit,
    shortcuts: createDefaultShortcutRegistry('other'),
    dispatch,
    applyStyle: vi.fn(),
  };
  render(<stylePanelSection.render {...props} />);
  return { dispatch };
}

afterEach(cleanup);

describe('the component section', () => {
  it('registers for mains only', () => {
    expect(stylePanelSection).toMatchObject({
      id: 'component',
      title: 'Component',
      context: 'component',
      isSelectionOnly: true,
    });
  });

  it('shows the name and renames the main on Enter, not on Escape', () => {
    const { store } = createComponentBoard();
    const { dispatch } = renderSection(store);
    const name = screen.getByRole<HTMLInputElement>('textbox', { name: 'Name' });
    expect(name.value).toBe('Card');
    fireEvent.change(name, { target: { value: 'Draft' } });
    fireEvent.keyDown(name, { key: 'Escape' });
    expect(name.value).toBe('Card');
    fireEvent.blur(name);
    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.change(name, { target: { value: 'Profile card' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'component',
      command: 'rename',
      id: 'card',
      name: 'Profile card',
    });
  });

  it('counts the main’s instances across the board', () => {
    const { store } = createComponentBoard({ isInstanceOnSecondPage: true });
    mustRun(store, 'createInstance', { componentId: 'card', x: 900, y: 0 });
    renderSection(store);
    expect(screen.getByText('2 instances')).toBeDefined();
    cleanup();
    renderSection(store, 'badge');
    expect(screen.getByText('1 instance')).toBeDefined();
  });

  it('places an instance', () => {
    const { store } = createComponentBoard();
    const { dispatch } = renderSection(store);
    fireEvent.click(screen.getByRole('button', { name: 'Place instance' }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'component',
      command: 'placeInstance',
      id: 'card',
    });
  });
});
