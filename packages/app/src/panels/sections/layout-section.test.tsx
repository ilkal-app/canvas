// @vitest-environment jsdom
// The inspector's layout section in jsdom, as the panel mounts it: each committed field is one
// `layout` canvas action for the whole selection.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_AUTO_LAYOUT, type BoardObject, type ObjectId } from '@canvas/schema';

import type { ShellAction } from '../../state/shell-action.js';
import { memoryShape } from '../__fixtures__/memory-board.js';
import type { StylePanelSectionProps } from '../panel-sections.js';

import { stylePanelSection } from './layout-section.js';

/**
 * Renders the section over a selection.
 *
 * @param selection - The selected objects.
 * @param others - Other objects on the board (the selection's parents).
 * @returns What the section dispatched.
 */
function renderSection(selection: readonly BoardObject[], others: readonly BoardObject[] = []) {
  const dispatch = vi.fn<(action: ShellAction) => void>();
  const byId = new Map([...selection, ...others].map((object) => [object.id, object]));
  const props = {
    context: 'shape',
    selection,
    board: { get: (id: ObjectId) => byId.get(id) },
    activeTool: 'select',
    dispatch,
    applyStyle: () => undefined,
  } as unknown as StylePanelSectionProps;
  render(<stylePanelSection.render {...props} />);
  return dispatch;
}

/**
 * Commits a value the way the browser does: the input's value, then its `change` event.
 *
 * @param input - The input.
 * @param value - The value.
 */
function commit(input: HTMLElement, value: string): void {
  (input as HTMLInputElement).value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

afterEach(cleanup);

describe('the layout section', () => {
  it('dispatches one layout action for the whole selection per committed field', () => {
    const a = { ...memoryShape('a', 'a0'), x: 5, y: 5 };
    const b = { ...memoryShape('b', 'a1'), x: 5, y: 40 };
    const dispatch = renderSection([a, b]);
    commit(screen.getByLabelText('X'), '120');
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'layout',
      ids: ['a', 'b'],
      field: 'x',
      value: 120,
    });
    commit(screen.getByLabelText(/Layout width/), '64');
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'layout',
      ids: ['a', 'b'],
      field: 'width',
      value: 64,
    });
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  describe('inside an auto-layout container', () => {
    const frameAt = (id: string): BoardObject =>
      ({
        id: id as ObjectId,
        type: 'frame',
        parentId: null,
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
      }) as unknown as BoardObject;
    const row = { ...frameAt('row'), autoLayout: DEFAULT_AUTO_LAYOUT } as BoardObject;
    const plain = frameAt('plain');

    it('makes X and Y read-only, and offers fill as one layoutChild action', () => {
      const a = memoryShape('a', 'a0', 'row');
      const b = { ...memoryShape('b', 'a1', 'row'), layoutChild: { fill: true } };
      const dispatch = renderSection([a, b], [row]);
      expect(screen.getByLabelText(/^X/)).toHaveProperty('disabled', true);
      expect(screen.getByLabelText(/^Y/)).toHaveProperty('disabled', true);
      expect(screen.getByLabelText(/Layout width/)).toHaveProperty('disabled', false);
      const fill = screen.getByRole('button', { name: 'Fill container' });
      expect(fill.getAttribute('aria-pressed')).toBe('mixed');
      fireEvent.click(fill);
      expect(dispatch).toHaveBeenCalledExactlyOnceWith({
        type: 'autoLayout',
        ids: ['a', 'b'],
        change: { kind: 'child', layoutChild: { fill: true } },
      });
    });

    it('leaves X and Y editable, and shows no fill, outside one', () => {
      renderSection([memoryShape('a', 'a0', 'plain')], [plain]);
      expect(screen.getByLabelText(/^X/)).toHaveProperty('disabled', false);
      expect(screen.queryByRole('button', { name: 'Fill container' })).toBeNull();
    });

    it('shows no fill for a selection only partly inside one', () => {
      renderSection([memoryShape('a', 'a0', 'row'), memoryShape('b', 'a1', 'plain')], [row, plain]);
      expect(screen.queryByRole('button', { name: 'Fill container' })).toBeNull();
      expect(screen.getByLabelText(/^X/)).toHaveProperty('disabled', false);
    });
  });
});
