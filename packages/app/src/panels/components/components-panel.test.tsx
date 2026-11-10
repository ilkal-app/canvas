// @vitest-environment jsdom
// The components panel at the top of the layers panel (ruling 3): every live main on
// the board with its page; go to one, place one, drag one onto the canvas.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { mustRun } from '../../engine/__fixtures__/component-board.js';
import { mountComponentBoard } from '../../engine/__fixtures__/mounted-component-board.js';
import { COMPONENT_DRAG_TYPE } from '../../engine/component-drop.js';
import type { ShellAction } from '../../state/shell-action.js';

import { ComponentsPanel } from './components-panel.js';

/**
 * The panel over the card board, mounted as the app mounts it, the card's instance on a second
 * page shown.
 *
 * @param canEdit - Whether the person may edit.
 * @returns The board and the dispatch spy.
 */
function renderPanel(canEdit = true) {
  const mounted = mountComponentBoard(true);
  mounted.pages.show(mounted.instancePageId);
  const dispatch = vi.fn<(action: ShellAction) => void>();
  render(
    <ComponentsPanel view={mounted.document.panels.board} dispatch={dispatch} canEdit={canEdit} />,
  );
  return { ...mounted, dispatch };
}

afterEach(cleanup);

describe('the components panel', () => {
  it('lists every main on the board with its page, though another page is shown', () => {
    renderPanel();
    const list = screen.getByRole('list', { name: 'Components' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['BadgePage 1Place', 'CardPage 1Place']);
  });

  it('describes a variant set’s row by its axes', () => {
    const { store } = renderPanel();
    act(() => {
      mustRun(store, 'setVariantAxes', {
        componentId: 'card',
        axes: [{ name: 'state', values: ['rest', 'hover'] }],
      });
    });
    const go = screen.getByRole('button', { name: /^Card, on / });
    expect(go.getAttribute('aria-describedby')).not.toBeNull();
    expect(screen.getByText('state: rest, hover').id).toBe(go.getAttribute('aria-describedby'));
  });

  it('goes to a main on a click and places an instance with Place', () => {
    const { dispatch } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Card, on Page 1' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'component', command: 'goToMain', id: 'card' });
    fireEvent.click(screen.getByRole('button', { name: 'Place Card' }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'component',
      command: 'placeInstanceAt',
      id: 'card',
    });
  });

  it('puts the main on a row’s drag, for a drop on the canvas', () => {
    renderPanel();
    const [badge] = screen.getAllByRole('listitem');
    if (badge === undefined) throw new Error('no row');
    expect(badge.getAttribute('draggable')).toBe('true');
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (type: string, value: string) => data.set(type, value),
      effectAllowed: 'none',
    };
    fireEvent.dragStart(badge, { dataTransfer });
    expect(data.get(COMPONENT_DRAG_TYPE)).toBe('badge');
    expect(dataTransfer.effectAllowed).toBe('copy');
  });

  it('follows the board: a main renamed, mains deleted', () => {
    const { store } = renderPanel();
    act(() => {
      mustRun(store, 'renameFrame', { id: 'badge', name: 'Pill' });
    });
    expect(screen.getByRole('button', { name: 'Pill, on Page 1' })).toBeDefined();
    // Fresh generated ids: detaching the card's instance makes new children.
    let next = 0;
    const environment = { clock: () => 1, createId: () => `gen-${String(next++)}` as ObjectId };
    act(() => {
      mustRun(store, 'deleteObjects', { ids: ['card'] }, environment);
    });
    expect(screen.queryByRole('button', { name: 'Card, on Page 1' })).toBeNull();
    act(() => {
      mustRun(store, 'deleteObjects', { ids: ['badge'] }, environment);
    });
    expect(screen.queryByRole('list', { name: 'Components' })).toBeNull();
  });

  it('gives a person who cannot edit the list alone', () => {
    renderPanel(false);
    expect(screen.queryByRole('button', { name: 'Place Card' })).toBeNull();
    expect(screen.getAllByRole('listitem')[0]?.getAttribute('draggable')).toBe('false');
    expect(screen.getByRole('button', { name: 'Card, on Page 1' })).toBeDefined();
  });
});
